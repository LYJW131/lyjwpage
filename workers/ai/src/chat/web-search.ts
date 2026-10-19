import type Anthropic from "@anthropic-ai/sdk";

import type { GodChatWebSearch } from "@shared/god-chat-tiers";
import { object } from "@shared/json";

import type { Env } from "../runtime";

export type WebPage = { url: string; title: string; published?: string; text: string };

const SEARCH_RESULTS = 5;
const SEARCH_CHARS_PER_RESULT = 1_500;
const FETCH_CHARS = 20_000;
const PROVIDER_TIMEOUT_MS = 15_000;
export const WEB_CATEGORIES = ["web", "news", "papers"] as const;
export type WebCategory = (typeof WEB_CATEGORIES)[number];
const EXA_CATEGORY: Record<WebCategory, string | undefined> = { web: undefined, news: "news", papers: "research paper" };
export const MAX_WEB_FETCHES = 4;

export const WEB_SEARCH_TOOL: Anthropic.Beta.BetaTool = {
  name: "web_search",
  description: "Search the web for anything outside this site. Returns the top pages with relevant excerpts; cite what you use. Write the query as a short, specific search in English only, whatever language the visitor writes in; use the English or romanized name for titles and people.",
  input_schema: {
    type: "object",
    properties: {
      query: { type: "string", description: "The search query." },
      category: { type: "string", enum: [...WEB_CATEGORIES], description: "web for general pages, news for recent news articles, papers for research papers." },
    },
    required: ["query", "category"],
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

// 句末的英文标点和没配对的右括号不算 URL：「见 https://a.dev/x.」「(https://a.dev/x)」；路径里配对的括号保留，如维基的 Function_(mathematics)。
function trimUrl(raw: string): string {
  let url = raw.replace(/[.,;:!?'"]+$/, "");
  while (url.endsWith(")") && url.split("(").length < url.split(")").length) url = url.slice(0, -1).replace(/[.,;:!?'"]+$/, "");
  return url;
}

export function urlsIn(text: string): string[] {
  return [...text.matchAll(/https?:\/\/[^\s<>"`\]）】，。、；！？]+/g)].flatMap((match) => urlKey(trimUrl(match[0])) ?? []);
}

export async function fetchJson(url: string, init: RequestInit, signal: AbortSignal): Promise<Record<string, unknown>> {
  const response = await fetch(url, { ...init, signal: AbortSignal.any([signal, AbortSignal.timeout(PROVIDER_TIMEOUT_MS)]) });
  if (!response.ok) throw new Error(`${new URL(url).host} ${response.status}`);
  const data = object(await response.json());
  if (!data) throw new Error(`${new URL(url).host} returned a non-object`);
  return data;
}

const post = (origin: string) => (path: string, key: string, body: unknown, signal: AbortSignal) =>
  fetchJson(`${origin}${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify(body) }, signal);
const exa = post("https://api.exa.ai");
const deepseek = post("https://api.deepseek.com");

export const WEB_SEARCH_PROVIDERS = ["exa", "deepseek"] as const;
type WebSearchService = (typeof WEB_SEARCH_PROVIDERS)[number];
type WebSearchEndpoint = { service: WebSearchService; key: string };
export type WebSearchBackend = { search: WebSearchEndpoint; fetch: WebSearchEndpoint };

// 搜索默认 Exa：同一批代表性查询里 DeepSeek Search 更快更新、中文更好，但英文技术文档的命中更散。读页一律优先 Exa：
// DeepSeek Fetch 实测要 4–12 秒、偶尔超时，正文的 Markdown 还被转义成 \#、\,。
export function webSearchProvider(env: Pick<Env, "EXA_API_KEY" | "DEEPSEEK_API_KEY" | "WEB_SEARCH_PROVIDER">): WebSearchBackend | undefined {
  const exaKey = env.EXA_API_KEY ? { service: "exa" as const, key: env.EXA_API_KEY } : undefined;
  const deepseekKey = env.DEEPSEEK_API_KEY ? { service: "deepseek" as const, key: env.DEEPSEEK_API_KEY } : undefined;
  const search = env.WEB_SEARCH_PROVIDER?.trim() === "deepseek" ? (deepseekKey ?? exaKey) : exaKey;
  const fetch = exaKey ?? deepseekKey;
  return search && fetch ? { search, fetch } : undefined;
}

export function webSearchServices(env: Pick<Env, "EXA_API_KEY" | "DEEPSEEK_API_KEY" | "WEB_SEARCH_PROVIDER">): GodChatWebSearch {
  const backend = webSearchProvider(env);
  return { search: backend?.search.service ?? null, fetch: backend?.fetch.service ?? null };
}

function page(raw: Record<string, unknown> | null, text: string | undefined, limit: number): WebPage | undefined {
  if (!raw || typeof raw.url !== "string" || !text?.trim()) return undefined;
  const published = typeof raw.publishedDate === "string" ? raw.publishedDate : undefined;
  return {
    url: raw.url,
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : raw.url,
    ...(published && { published: published.slice(0, 10) }),
    text: text.trim().slice(0, limit),
  };
}

const strings = (value: unknown): string[] => (Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : []);
const results = (data: Record<string, unknown>) => (Array.isArray(data.results) ? data.results.map(object) : []);

// DeepSeek 把同一页的不同片段当成不同结果，URL 末尾带 #1、#2；去掉后按页去重。
const pageUrl = (url: string) => url.replace(/#\d+$/, "");

async function deepseekSearch(key: string, query: string, signal: AbortSignal): Promise<WebPage[]> {
  const data = await deepseek("/v1/tools/search", key, { query: query.slice(0, 128), count: SEARCH_RESULTS }, signal);
  const seen = new Set<string>();
  return results(data).flatMap((raw) => {
    if (!raw || typeof raw.url !== "string") return [];
    const url = pageUrl(raw.url);
    if (seen.has(url)) return [];
    seen.add(url);
    const summary = typeof raw.summary === "string" && raw.summary.trim() ? raw.summary : typeof raw.snippet === "string" ? raw.snippet : undefined;
    return page({ ...raw, url, publishedDate: raw.date }, summary, SEARCH_CHARS_PER_RESULT) ?? [];
  });
}

export async function webSearch(backend: WebSearchBackend, query: string, category: WebCategory, signal: AbortSignal): Promise<WebPage[]> {
  if (backend.search.service === "deepseek") return deepseekSearch(backend.search.key, query, signal);
  const exaCategory = EXA_CATEGORY[category];
  const data = await exa("/search", backend.search.key, {
    query,
    type: "lite",
    numResults: SEARCH_RESULTS,
    ...(exaCategory && { category: exaCategory }),
    contents: { highlights: { maxCharacters: SEARCH_CHARS_PER_RESULT } },
  }, signal);
  return results(data).flatMap((raw) => page(raw, raw ? strings(raw.highlights).join("\n…\n") : undefined, SEARCH_CHARS_PER_RESULT) ?? []);
}

export async function webFetch(backend: WebSearchBackend, url: string, signal: AbortSignal): Promise<WebPage | undefined> {
  if (backend.fetch.service === "deepseek") {
    const data = await deepseek("/v1/tools/fetch", backend.fetch.key, { url }, signal);
    return page({ url, title: data.title }, typeof data.content === "string" ? data.content : undefined, FETCH_CHARS);
  }
  const data = await exa("/contents", backend.fetch.key, { urls: [url], text: { maxCharacters: FETCH_CHARS } }, signal);
  const raw = results(data)[0] ?? null;
  return page(raw, typeof raw?.text === "string" ? raw.text : undefined, FETCH_CHARS);
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

export function searchResultText(pages: WebPage[]): string {
  return pages.map((item, index) => `[${index + 1}] ${item.title}${item.published ? ` (${item.published})` : ""}\nURL: ${item.url}\n${item.text}`).join("\n\n");
}
