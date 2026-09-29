import { requestState } from "@shared/request-state";
import { askStorage, key, tellStorage, withStorage } from "@/lib/storage";

/**
 * 通用 TTL 缓存 + in-flight 去重 + 负缓存，给需要本站主动去拉的上游用：
 * - 同一个 key 并发进来时只会真正打一次上游，其余人等同一个 Promise
 * - 上游报错时短暂缓存错误，避免上游挂掉后被前端轮询打爆
 *
 * 值存在 `lib/storage-driver` 背后的驱动里（api Worker 是 DO SQLite，采集 Worker 是
 * KV），重启和多实例都能共享。Worker 驱动下存储故障直接抛出，不退回内存；进程内存
 * 那份只在存储不可达时兜底（Node 驱动）。in-flight 去重不落存储，按 requestState 的
 * 作用域走（没有作用域时是进程全局那一份）—— 它要挡的是同一作用域内的并发穿透，
 * 这件事存储代劳不了。
 */

type Entry = {
  value: unknown;
  expiresAt: number;
  /** 这份有没有真的落进 Storage。false 表示它只活在本进程内存里，见 get */
  persisted: boolean;
};

const memory = () => requestState("cache-memory", () => new Map<string, Entry>());
const inflightMap = () => requestState("cache-inflight", () => new Map<string, Promise<unknown>>());

/**
 * 进程内那份副本的条数上限。
 *
 * 过期项只在被命中时才顺手删，没有周期清扫 —— 键是「歌名+歌手+专辑」这种一首歌
 * 一条、TTL 很长的东西，短命的实例有寿命兜着，长驻进程上却是只增不减。Map 的
 * 插入顺序顺便充当 LRU，和 telemetry 的 rememberDesktopIcon 同一套写法。它只是
 * 存储不可达时的备份，几百条足够。
 */
const MEMORY_LIMIT = 500;

/** 上游报错后，多久之内不再重试 */
const NEGATIVE_TTL_MS = 5_000;
const NEGATIVE_PREFIX = "neg";

function memoryEntry(k: string): Entry | undefined {
  const hit = memory().get(k);
  if (!hit) return undefined;
  if (hit.expiresAt <= Date.now()) {
    memory().delete(k);
    return undefined;
  }
  return hit;
}

function memoryGet<T>(k: string): T | undefined {
  return memoryEntry(k)?.value as T | undefined;
}

function memorySet(k: string, value: unknown, ttlMs: number, persisted: boolean) {
  // 重新插入，让它排到末尾：淘汰的总是最久没被写过的那条
  memory().delete(k);
  memory().set(k, { value, expiresAt: Date.now() + Math.max(1_000, ttlMs), persisted });
  while (memory().size > MEMORY_LIMIT) {
    const oldest = memory().keys().next().value;
    if (oldest === undefined) break;
    memory().delete(oldest);
  }
}

/**
 * 存储答得上话就以它为准，**它说没有就是没有**；只有不可达才退回进程内存。
 *
 * 「存储说 null」和「存储连不上」必须分开（`askStorage` 就是为此把两者拆成
 * `reachable`）：混了的话，清空存储、或者另一个实例 `remove()` 掉的值，在本进程里
 * 还会按原 TTL 活着。和 lib/storage 的 mirrorKey 同一条规则。
 *
 * 唯一的例外是**上次写没落进去**的那条（`persisted` 为假）：当时存储不可达，之后
 * 恢复了，那份值却只在本进程内存里。这时存储说 null 不是「被人删了」而是「从没写进
 * 去」，得继续用内存那份 —— 不然 cached() 每次都重跑 loader，负缓存也一起失灵，
 * 恰好在存储不对劲的时候把上游打得最狠。和 mirrorKey 的 persisted 是同一条规则。
 */
export async function get<T>(k: string): Promise<T | undefined> {
  const answer = await askStorage((storage) => storage.get(key("cache", k)));
  if (!answer.reachable) return memoryGet<T>(k);
  if (answer.value == null) {
    const local = memoryEntry(k);
    return local && !local.persisted ? (local.value as T) : undefined;
  }
  try {
    return JSON.parse(answer.value) as T;
  } catch {
    // 存进去的一定是 JSON，解不出来说明是脏数据，当作没有
    return undefined;
  }
}

export async function put<T>(k: string, value: T, ttlMs: number) {
  // 存储契约要求 TTL 是正整数（shared/storage-contract 的 validTtl）：带小数的 TTL
  // （比如按半衰期除出来的 x.5 毫秒）整条 set 都会被拒。约束在这层收口（向上取整，
  // 再设个下限），不指望每个调用方自己取整。
  const ttl = Math.max(1_000, Math.ceil(ttlMs));
  // 先按「没落进去」写内存：存储那一步在飞时并发的 get 也能拿到这份
  memorySet(k, value, ttl, false);
  const persisted = await tellStorage((storage) =>
    storage.set(key("cache", k), JSON.stringify(value), { ttlMs: ttl }),
  );
  if (persisted) memorySet(k, value, ttl, true);
}

/**
 * 主动作废一条：内存和存储两层一起删。
 *
 * 给「缓存的值被上游判了死刑」的场景用 —— TTL 还没到、但值已经确认失效
 * （比如动态封面那份扒来的 web token 吃了 401），等它自然过期只会让失效
 * 期间的请求全部陪葬。
 */
export async function remove(k: string) {
  memory().delete(k);
  await withStorage(async (storage) => storage.remove(key("cache", k)), null);
}

export async function cached<T>(
  k: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  /**
   * 值和负缓存一起问，不串着问。
   *
   * 命中时那条负缓存的读是白问的 —— 但两条读并发发出、往返重叠，不多花一个来回。
   * 没命中时省下的才是实打实的一个来回，而那正是要紧的时候：换歌那一刻要现查目录，
   * 「此刻在听」的推送就压在这条链路上。
   */
  const [hit, failure] = await Promise.all([
    get<T>(k),
    get<{ message: string }>(`${NEGATIVE_PREFIX}:${k}`),
  ]);
  if (hit !== undefined) return hit;
  if (failure) throw new Error(failure.message);

  const running = inflightMap().get(k);
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
      inflightMap().delete(k);
    }
  })();

  inflightMap().set(k, promise);
  return promise;
}
