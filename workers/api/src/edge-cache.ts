/**
 * 按键查询（歌词、动态封面）的机房级缓存，用的是 Workers Cache API（`caches.default`）。
 *
 * 结果只由参数决定、不随状态变化，命中时不进 StateHub。它只存在当前机房、未命中才填，
 * 也不合并并发未命中：同一机房同一时刻的第一批请求仍各自回源，挡住的是之后的重复请求。
 * 条目跨部署保留（版本不进键），所以键里带着 SQLite 那一层的版本段，外加下面这个
 * 响应外形的版本，改了哪一层都会让旧条目自然失效。
 */

/** 路由响应外形（不止 SQLite 里的结果）变了时升它 */
const EDGE_CACHE_VERSION = "v1";
/** 合成缓存键的路径前缀，不是真实路由，外部请求打不到 */
const EDGE_CACHE_PATH = "/__edge-cache";

export type EdgeCacheStatus = "hit" | "miss" | "bypass";
export type EdgeCache = Pick<Cache, "match" | "put">;

/** workerd 之外（Node 单测）没有 `caches`，照常回源 */
export function defaultEdgeCache(): EdgeCache | undefined {
  return typeof caches === "undefined" ? undefined : (caches as CacheStorage & { default?: Cache }).default;
}

export function edgeCacheRequest(origin: string, key: string): Request {
  return new Request(`${origin}${EDGE_CACHE_PATH}/${EDGE_CACHE_VERSION}/${encodeURIComponent(key)}`);
}

function withStatus(response: Response, status: EdgeCacheStatus): Response {
  const headers = new Headers(response.headers);
  headers.set("X-Edge-Cache", status);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

/**
 * 命中直接回；未命中回源，只有 200 在响应之后写回（400 / 500 本来就是 no-store）。
 * 缓存读写出错只记日志，不影响回源那一份。存的是路由原样的响应，不含 CORS 头，
 * CORS 由调用方每次按访客的 Origin 加。
 */
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
    waitUntil(cache.put(key, response.clone()).catch((error: unknown) => console.warn("[edge-cache] put", error)));
  }
  return withStatus(response, "miss");
}
