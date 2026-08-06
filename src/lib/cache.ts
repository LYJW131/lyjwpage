/**
 * 进程内 TTL 缓存 + in-flight 去重 + 负缓存。
 *
 * 三个状态源（Emby / Apple Music / Anker）都靠它挡住重复请求：
 * - 同一个 key 并发进来时只会真正打一次上游，其余人等同一个 Promise
 * - 上游报错时短暂缓存错误，避免上游挂掉后被前端轮询打爆
 */

type Entry<T> = { value: T; expiresAt: number };

const store = new Map<string, Entry<unknown>>();
const inflight = new Map<string, Promise<unknown>>();
const negative = new Map<string, Entry<Error>>();

/** 上游报错后，多久之内不再重试 */
const NEGATIVE_TTL_MS = 5_000;

export async function cached<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  const now = Date.now();

  const hit = store.get(key);
  if (hit && hit.expiresAt > now) return hit.value as T;

  const failed = negative.get(key);
  if (failed && failed.expiresAt > now) throw failed.value;

  const running = inflight.get(key);
  if (running) return running as Promise<T>;

  const promise = (async () => {
    try {
      const value = await loader();
      store.set(key, { value, expiresAt: Date.now() + ttlMs });
      negative.delete(key);
      return value;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      negative.set(key, { value: err, expiresAt: Date.now() + NEGATIVE_TTL_MS });
      throw err;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);
  return promise;
}

/** 手动写入，给 JWT 这类自带过期时间的值用 */
export function put<T>(key: string, value: T, ttlMs: number) {
  store.set(key, { value, expiresAt: Date.now() + Math.max(1_000, ttlMs) });
}

export function get<T>(key: string): T | undefined {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt <= Date.now()) {
    store.delete(key);
    return undefined;
  }
  return hit.value as T;
}
