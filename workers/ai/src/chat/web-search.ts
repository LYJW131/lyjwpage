import type Anthropic from "@anthropic-ai/sdk";

import { object } from "@shared/json";

export type WebPage = { url: string; title: string; published?: string; text: string };

const SEARCH_RESULTS = 5;
const SEARCH_CHARS_PER_RESULT = 1_500;
const FETCH_CHARS = 20_000;
const PROVIDER_TIMEOUT_MS = 15_000;
export const WEB_CATEGORIES = ["web", "news", "papers"] as const;
export type WebCategory = (typeof WEB_CATEGORIES)[number];
const EXA_CATEGORY: Record<WebCategory, string | undefined> = { web: undefined, news: "news", papers: "research paper" };
export const MAX_WEB_FETCHES = 4;
// lyjw 不要中文互联网的来源、查询只用英文：含中日韩文字的查询拦下，再排除常见中文站点兜底；Exa 没有按语言过滤的参数，域名会匹配子域。
const EXCLUDED_DOMAINS = [
  "*.cn", "*.tw", "*.hk", "zhihu.com", "baidu.com", "csdn.net", "bilibili.com", "douban.com", "qq.com", "163.com", "sohu.com", "sina.com",
  "weibo.com", "toutiao.com", "jianshu.com", "cnblogs.com", "segmentfault.com", "oschina.net", "36kr.com", "ithome.com",
  "smzdm.com", "zh.wikipedia.org", "bgm.tv", "bangumi.tv", "ifeng.com", "xiaohongshu.com", "douyin.com", "gcores.com", "gamersky.com",
];

export const nonEnglishQuery = (query: string) => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(query);

export const WEB_SEARCH_TOOL: Anthropic.Beta.BetaTool = {
  name: "web_search",
  description: "Search the web for anything outside this site. Returns the top pages with relevant excerpts; cite what you use. Write the query as a short, specific search in English only, whatever language the visitor writes in; use the English or romanized name for titles and people. Chinese-language sites are excluded.",
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

const exa = (path: string, key: string, body: unknown, signal: AbortSignal) =>
  fetchJson(`https://api.exa.ai${path}`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify(body) }, signal);

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

export async function webSearch(key: string, query: string, category: WebCategory, signal: AbortSignal): Promise<WebPage[]> {
  const exaCategory = EXA_CATEGORY[category];
  const data = await exa("/search", key, {
    query,
    type: "fast",
    numResults: SEARCH_RESULTS,
    excludeDomains: EXCLUDED_DOMAINS,
    ...(exaCategory && { category: exaCategory }),
    contents: { highlights: { maxCharacters: SEARCH_CHARS_PER_RESULT } },
  }, signal);
  return results(data).flatMap((raw) => page(raw, raw ? strings(raw.highlights).join("\n…\n") : undefined, SEARCH_CHARS_PER_RESULT) ?? []);
}

export async function webFetch(key: string, url: string, signal: AbortSignal): Promise<WebPage | undefined> {
  const data = await exa("/contents", key, { urls: [url], text: { maxCharacters: FETCH_CHARS } }, signal);
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
