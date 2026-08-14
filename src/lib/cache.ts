import { key, withRedis } from "@/lib/redis";

/**
 * 通用 TTL 缓存 + in-flight 去重 + 负缓存。
 *
 * 给还需要本站主动去拉的上游用（如今只剩 Apple Music，其余状态源都是推进来的）：
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

export async function cached<T>(
  k: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  /**
   * 值和负缓存一起问，不串着问。
   *
   * 命中时那条负缓存的 GET 是白问的 —— 但它和值那条在同一条连接上并发发出、
   * 在网络上重叠，多花的是 Redis 的一点点力气，不是一个来回。没命中时省下的
   * 才是实打实的一个来回，而那正是要紧的时候：换歌那一刻要现查目录，
   * 「此刻在听」的推送就压在这条链路上。
   */
  const [hit, failure] = await Promise.all([
    get<T>(k),
    get<{ message: string }>(`${NEGATIVE_PREFIX}:${k}`),
  ]);
  if (hit !== undefined) return hit;
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
