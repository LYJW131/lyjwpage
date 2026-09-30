// 缓存跨部署保留；响应外形变化必须升版本，不能只升级内部结果的缓存键。
const EDGE_CACHE_VERSION = "v2";
const EDGE_CACHE_PATH = "/__edge-cache";

// Cloudflare 会按区域浏览器 TTL 改写 max-age；另存原值以恢复短期负缓存。
const ORIGIN_CACHE_CONTROL = "X-Origin-Cache-Control";

export type EdgeCacheStatus = "hit" | "miss" | "bypass";
export type EdgeCache = Pick<Cache, "match" | "put">;

export function defaultEdgeCache(): EdgeCache | undefined {
  return typeof caches === "undefined" ? undefined : (caches as CacheStorage & { default?: Cache }).default;
}

export function edgeCacheRequest(origin: string, key: string): Request {
  return new Request(`${origin}${EDGE_CACHE_PATH}/${EDGE_CACHE_VERSION}/${encodeURIComponent(key)}`);
}

function withStatus(response: Response, status: EdgeCacheStatus): Response {
  const headers = new Headers(response.headers);
  const cacheControl = headers.get(ORIGIN_CACHE_CONTROL);
  if (cacheControl) headers.set("Cache-Control", cacheControl);
  headers.delete(ORIGIN_CACHE_CONTROL);
  headers.set("X-Edge-Cache", status);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

function forStorage(response: Response): Response {
  const headers = new Headers(response.headers);
  const cacheControl = headers.get("Cache-Control");
  if (cacheControl) headers.set(ORIGIN_CACHE_CONTROL, cacheControl);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export async function serveWithEdgeCache(options: {
  cache: EdgeCache | undefined;
  key: Request | null;
  origin: () => Promise<Response>;
  waitUntil: (promise: Promise<unknown>) => void;
}): Promise<Response> {
  const { cache, key, origin, waitUntil } = options;
  if (!cache || !key) return withStatus(await origin(), "bypass");

  const hit = await cache.match(key).catch((error: unknown) => {
    console.warn("[edge-cache] match", error);
    return undefined;
  });
  if (hit) return withStatus(hit, "hit");

  const response = await origin();
  if (response.status === 200) {
    waitUntil(cache.put(key, forStorage(response.clone())).catch((error: unknown) => console.warn("[edge-cache] put", error)));
  }
  return withStatus(response, "miss");
}
