import { requestState } from "@shared/request-state";
import { appleCacheKv } from "@/lib/apple-cache-store";

// KV 的过期时间不能短于 60 秒；查询失败只记在本次请求里，交给下一次写入或请求重试。
const KV_MIN_TTL_S = 60;

type Memo = { hits: Map<string, unknown>; failures: Map<string, Error>; inflight: Map<string, Promise<unknown>> };
const memo = () => requestState("apple-cache", (): Memo => ({ hits: new Map(), failures: new Map(), inflight: new Map() }));

function storageKey(k: string): string {
  return `${process.env.STORAGE_PREFIX ?? "lyjwpage"}:${k}`;
}

export async function get<T>(k: string): Promise<T | undefined> {
  if (memo().hits.has(k)) return memo().hits.get(k) as T;
  const kv = appleCacheKv();
  if (!kv) return undefined;
  try {
    const raw = await kv.get(storageKey(k), "text");
    return raw == null ? undefined : (JSON.parse(raw) as T);
  } catch (error) {
    console.warn("[apple-cache] get", k, error instanceof Error ? error.message : String(error));
    return undefined;
  }
}

export async function put<T>(k: string, value: T, ttlMs: number): Promise<void> {
  memo().hits.set(k, value);
  const kv = appleCacheKv();
  if (!kv) return;
  try {
    await kv.put(storageKey(k), JSON.stringify(value), { expirationTtl: Math.max(KV_MIN_TTL_S, Math.ceil(ttlMs / 1000)) });
  } catch (error) {
    console.warn("[apple-cache] put", k, error instanceof Error ? error.message : String(error));
  }
}

export async function remove(k: string): Promise<void> {
  memo().hits.delete(k);
  await appleCacheKv()?.delete(storageKey(k)).catch(() => {});
}

export async function cached<T>(
  k: string,
  ttlMs: number | ((value: T) => number),
  loader: () => Promise<T>,
): Promise<T> {
  const failure = memo().failures.get(k);
  if (failure) throw failure;
  const running = memo().inflight.get(k);
  if (running) return running as Promise<T>;
  const promise = (async () => {
    const hit = await get<T>(k);
    if (hit !== undefined) return hit;
    try {
      const value = await loader();
      await put(k, value, typeof ttlMs === "function" ? ttlMs(value) : ttlMs);
      return value;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      memo().failures.set(k, err);
      throw err;
    }
  })().finally(() => memo().inflight.delete(k));
  memo().inflight.set(k, promise);
  return promise;
}
