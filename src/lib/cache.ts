import { key, withRedis } from "@/lib/redis";

/**
 * 通用 TTL 缓存 + in-flight 去重 + 负缓存。
 *
 * 三个状态源（Emby / Apple Music / Anker）都靠它挡住重复请求：
 * - 同一个 key 并发进来时只会真正打一次上游，其余人等同一个 Promise
 * - 上游报错时短暂缓存错误，避免上游挂掉后被前端轮询打爆
 *
 * 值存在 Redis 里，进程重启和多实例都能共享。没配 Redis 就退回进程内存。
 * in-flight 去重始终是进程内的 —— 它要挡的是同一进程内的并发穿透，
 * 这件事 Redis 代劳不了。
 */

type Entry = { value: unknown; expiresAt: number };

const memory = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();

/** 上游报错后，多久之内不再重试 */
const NEGATIVE_TTL_MS = 5_000;
const NEGATIVE_PREFIX = "neg";

function memoryGet<T>(k: string): T | undefined {
  const hit = memory.get(k);
  if (!hit) return undefined;
  if (hit.expiresAt <= Date.now()) {
    memory.delete(k);
    return undefined;
  }
  return hit.value as T;
}

function memorySet(k: string, value: unknown, ttlMs: number) {
  memory.set(k, { value, expiresAt: Date.now() + Math.max(1_000, ttlMs) });
}

export async function get<T>(k: string): Promise<T | undefined> {
  const raw = await withRedis(async (redis) => redis.get(key("cache", k)), null);
  if (raw != null) {
    try {
      return JSON.parse(raw) as T;
    } catch {
      // 存进去的一定是 JSON，解不出来说明是脏数据，当作没有
    }
  }
  return memoryGet<T>(k);
}

export async function put<T>(k: string, value: T, ttlMs: number) {
  const ttl = Math.max(1_000, ttlMs);
  memorySet(k, value, ttl);
  await withRedis(
    async (redis) => redis.set(key("cache", k), JSON.stringify(value), "PX", ttl),
    null,
  );
}

/** 让某个前缀下的缓存立即失效。用于「事件到了，下次请求必须重新取」 */
export async function invalidate(prefix: string) {
  for (const k of memory.keys()) {
    if (k.startsWith(prefix)) memory.delete(k);
  }
  await withRedis(async (redis) => {
    // 键数量很少（个位数），scan 一遍即可，不用担心阻塞
    const pattern = key("cache", `${prefix}*`);
    const keys: string[] = [];
    let cursor = "0";
    do {
      const [next, batch] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
      cursor = next;
      keys.push(...batch);
    } while (cursor !== "0");
    if (keys.length) await redis.del(...keys);
    return null;
  }, null);
}

export async function cached<T>(
  k: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  const hit = await get<T>(k);
  if (hit !== undefined) return hit;

  const failure = await get<{ message: string }>(`${NEGATIVE_PREFIX}:${k}`);
  if (failure) throw new Error(failure.message);

  const running = inflight.get(k);
  if (running) return running as Promise<T>;

  const promise = (async () => {
    try {
      const value = await loader();
      await put(k, value, ttlMs);
      return value;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      await put(`${NEGATIVE_PREFIX}:${k}`, { message: err.message }, NEGATIVE_TTL_MS);
      throw err;
    } finally {
      inflight.delete(k);
    }
  })();

  inflight.set(k, promise);
  return promise;
}
