import { FIRST_SCREEN_CACHE_LIFE } from "./first-screen-cache";

// ESA 从收到响应起用 max-age 计新鲜，不扣上游 Age。SWR 是过期后还能继续吐旧 HTML 的上限，跟首屏 revalidate 走；源站故障另走 stale-if-error。
export const HOMEPAGE_STALE_IF_ERROR_SECONDS = 86400;

// 这些头区分文档和飞行数据。飞行数据若套用文档的公共 max-age，边缘会把已经过期的响应再存一轮。
const FLIGHT_HEADERS = ["rsc", "next-router-state-tree", "next-router-prefetch", "next-router-segment-prefetch"] as const;

export type CacheHeaderRule = {
  source: string;
  headers: { key: string; value: string }[];
  has?: { type: "header"; key: string }[];
  missing?: { type: "header"; key: string }[];
};

export function homepageDocumentCacheControl(): string {
  const { stale, revalidate } = FIRST_SCREEN_CACHE_LIFE;
  return `public, max-age=${stale}, stale-while-revalidate=${revalidate}, stale-if-error=${HOMEPAGE_STALE_IF_ERROR_SECONDS}`;
}

export function homepageFlightCacheControl(): string {
  return "private, max-age=0";
}

export function homepageCacheHeaderRules(): CacheHeaderRule[] {
  const flight = homepageFlightCacheControl();
  const document = homepageDocumentCacheControl();
  return [
    ...FLIGHT_HEADERS.map((key) => ({
      source: "/",
      has: [{ type: "header" as const, key }],
      headers: [{ key: "Cache-Control", value: flight }],
    })),
    {
      source: "/",
      missing: FLIGHT_HEADERS.map((key) => ({ type: "header" as const, key })),
      headers: [{ key: "Cache-Control", value: document }],
    },
  ];
}

function headerPresent(headers: { get(name: string): string | null }, name: string): boolean {
  return headers.get(name) != null;
}

export function homepageCacheControl(headers: { get(name: string): string | null }): string[] {
  const matched: string[] = [];
  for (const rule of homepageCacheHeaderRules()) {
    if (rule.has?.some((item) => !headerPresent(headers, item.key))) continue;
    if (rule.missing?.some((item) => headerPresent(headers, item.key))) continue;
    for (const header of rule.headers) {
      if (header.key === "Cache-Control") matched.push(header.value);
    }
  }
  return matched;
}
