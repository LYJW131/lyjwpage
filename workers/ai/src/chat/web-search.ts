import type Anthropic from "@anthropic-ai/sdk";

import { object } from "@shared/json";

import type { Env } from "../runtime";

export type WebProvider = "exa" | "parallel";
export type WebSearcher = { provider: WebProvider; key: string };
export type WebPage = { url: string; title: string; published?: string; text: string };

const SEARCH_RESULTS = 5;
const SEARCH_CHARS_PER_RESULT = 1_500;
const FETCH_CHARS = 20_000;
const PROVIDER_TIMEOUT_MS = 15_000;
export const MAX_WEB_FETCHES = 4;

export const WEB_SEARCH_TOOL: Anthropic.Beta.BetaTool = {
  name: "web_search",
  description: "Search the web for anything outside this site. Returns the top pages with relevant excerpts; cite what you use. Write the query as a short, specific search in the language the sources are most likely written in.",
  input_schema: {
    type: "object",
    properties: { query: { type: "string", description: "The search query." } },
    required: ["query"],
    additionalProperties: false,
  },
  strict: true,
};

export const WEB_FETCH_TOOL: Anthropic.Beta.BetaTool = {
  name: "web_fetch",
  description: "Read one web page in full when search excerpts are not enough. Only URLs the visitor wrote or that web_search returned in this reply can be read.",
  input_schema: {
    type: "object",
    properties: { url: { type: "string", description: "An http(s) URL from the visitor's messages or this reply's search results." } },
    required: ["url"],
    additionalProperties: false,
  },
  strict: true,
};

export function webSearchers(env: Env): WebSearcher[] {
  return [
    ...(env.EXA_API_KEY ? [{ provider: "exa" as const, key: env.EXA_API_KEY }] : []),
    ...(env.PARALLEL_API_KEY ? [{ provider: "parallel" as const, key: env.PARALLEL_API_KEY }] : []),
  ];
}

// A/B：每条回复随机抽一家，整条回复（含 web_fetch）都用它，日志按回复对比两家。
export function pickWebSearcher(env: Env, random = Math.random): WebSearcher | undefined {
  const searchers = webSearchers(env);
  return searchers[Math.floor(random() * searchers.length)];
}

// 去掉 #片段后比较；web_fetch 只读访客给过或本条回复搜到的 URL，免得网页里的指令让模型把对话内容拼进 URL 带出去。
export function urlKey(raw: string): string | undefined {
  try {
    const url = new URL(raw);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) return undefined;
    url.hash = "";
    return url.href;
  } catch {
    return undefined;
  }
}

export function urlsIn(text: string): string[] {
  return [...text.matchAll(/https?:\/\/[^\s<>"'`)\]）】，。、；]+/g)].flatMap((match) => urlKey(match[0]) ?? []);
}

async function call(url: string, key: string, body: unknown, signal: AbortSignal): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key },
    body: JSON.stringify(body),
    signal: AbortSignal.any([signal, AbortSignal.timeout(PROVIDER_TIMEOUT_MS)]),
  });
  if (!response.ok) throw new Error(`${new URL(url).host} ${response.status}`);
  const data = object(await response.json());
  if (!data) throw new Error(`${new URL(url).host} returned a non-object`);
  return data;
}

function page(raw: Record<string, unknown> | null, text: string | undefined, limit: number): WebPage | undefined {
  if (!raw || typeof raw.url !== "string" || !text?.trim()) return undefined;
  const published = typeof raw.publishedDate === "string" ? raw.publishedDate : typeof raw.publish_date === "string" ? raw.publish_date : undefined;
  return {
    url: raw.url,
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : raw.url,
    ...(published && { published: published.slice(0, 10) }),
    text: text.trim().slice(0, limit),
  };
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
const results = (data: Record<string, unknown>) => (Array.isArray(data.results) ? data.results.map(object) : []);

export async function webSearch({ provider, key }: WebSearcher, query: string, signal: AbortSignal): Promise<WebPage[]> {
  if (provider === "exa") {
    const data = await call("https://api.exa.ai/search", key, {
      query,
      type: "auto",
      numResults: SEARCH_RESULTS,
      contents: { highlights: { maxCharacters: SEARCH_CHARS_PER_RESULT } },
    }, signal);
    return results(data).flatMap((raw) => page(raw, raw ? strings(raw.highlights).join("\n…\n") : undefined, SEARCH_CHARS_PER_RESULT) ?? []);
  }
  const data = await call("https://api.parallel.ai/v1/search", key, {
    objective: query,
    search_queries: [query],
    mode: "fast",
    advanced_settings: { max_results: SEARCH_RESULTS, excerpt_settings: { max_chars_per_result: SEARCH_CHARS_PER_RESULT } },
  }, signal);
  return results(data).flatMap((raw) => page(raw, raw ? strings(raw.excerpts).join("\n…\n") : undefined, SEARCH_CHARS_PER_RESULT) ?? []);
}

export async function webFetch({ provider, key }: WebSearcher, url: string, objective: string, signal: AbortSignal): Promise<WebPage | undefined> {
  if (provider === "exa") {
    const data = await call("https://api.exa.ai/contents", key, { urls: [url], text: { maxCharacters: FETCH_CHARS } }, signal);
    const raw = results(data)[0] ?? null;
    return page(raw, typeof raw?.text === "string" ? raw.text : undefined, FETCH_CHARS);
  }
  const data = await call("https://api.parallel.ai/v1/extract", key, {
    urls: [url],
    objective,
    advanced_settings: { full_content: true },
  }, signal);
  const raw = results(data)[0] ?? null;
  const text = raw ? (typeof raw.full_content === "string" ? raw.full_content : strings(raw.excerpts).join("\n…\n")) : undefined;
  return page(raw, text, FETCH_CHARS);
}

export function searchResultBlocks(pages: WebPage[]): Anthropic.Beta.BetaSearchResultBlockParam[] {
  return pages.map((item) => ({
    type: "search_result",
    source: item.url,
    title: item.published ? `${item.title} (${item.published})` : item.title,
    content: [{ type: "text", text: item.text }],
    citations: { enabled: true },
  }));
}
