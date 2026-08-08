import Redis from "ioredis";

/**
 * Redis 连接。没配 REDIS_URL 就返回 null，各处缓存自动退回进程内存 ——
 * 本地开发不装 Redis 也能跑，线上 Redis 挂掉也只是丢缓存，不会让页面 500。
 */

const PREFIX = process.env.REDIS_PREFIX ?? "lyjwpage";

let client: Redis | null = null;
let initialised = false;
/** 连不上时先停用一段时间，避免每次请求都卡在重连上 */
let disabledUntil = 0;
const DISABLE_MS = 30_000;

export function getRedis(): Redis | null {
  if (Date.now() < disabledUntil) return null;

  if (!initialised) {
    initialised = true;
    const url = process.env.REDIS_URL;
    if (!url) return null;

    client = new Redis(url, {
      maxRetriesPerRequest: 1,
      /**
       * 必须让命令排队等连接建立。
       *
       * 关掉的话，进程刚起来、连接还没握手完的那几个请求会立即失败、退回
       * 空的内存兜底 —— 充电头据此误判成「没收到过推送」，走轮询并把 Redis
       * 里存着的推送历史覆盖掉。实测重启后历史确实被真实轮询读数换掉了。
       */
      enableOfflineQueue: true,
      connectTimeout: 2_000,
      // 排队也不能无限等：Redis 真挂了要尽快失败，退回内存而不是拖住请求
      commandTimeout: 2_000,
    });

    client.on("error", (error) => {
      // ioredis 会自己重连，这里只是别让未捕获的 error 事件把进程带崩
      if (Date.now() >= disabledUntil) {
        console.error("[redis]", error.message);
        disabledUntil = Date.now() + DISABLE_MS;
      }
    });
  }

  return client;
}

/** 统一加前缀，方便和同一个 Redis 里的其它东西区分开 */
export function key(...parts: string[]) {
  return [PREFIX, ...parts].join(":");
}

/** 包一层：Redis 出任何问题都退回 fallback，不往上抛 */
export async function withRedis<T>(
  run: (redis: Redis) => Promise<T>,
  fallback: T,
): Promise<T> {
  const redis = getRedis();
  if (!redis) return fallback;
  try {
    return await run(redis);
  } catch (error) {
    console.error("[redis]", error instanceof Error ? error.message : String(error));
    return fallback;
  }
}

/**
 * 问一次 Redis，把「它说没有」和「它答不上来」分开。
 *
 * 返回 null 表示 Redis 不可达 —— 没配 REDIS_URL、连不上、或正落在出错后那
 * 30 秒停用窗里。包一层 `{ value }` 才能和「Redis 好好答了，值就是 null」区分。
 *
 * 直接用 `withRedis(get, null)` 的话这两种情况在外面长得一模一样，只能一律
 * 退回进程内存副本 —— 结果是清空 Redis 之后数据还从内存里活着。实测踩到过。
 */
export async function askRedis<T>(
  load: (redis: Redis) => Promise<T>,
): Promise<{ value: T } | null> {
  return withRedis(async (redis) => ({ value: await load(redis) }), null);
}

/** 写一次 Redis，返回是否真的落进去了。false 表示这份目前只存在于进程内存 */
export async function tellRedis(run: (redis: Redis) => Promise<unknown>): Promise<boolean> {
  return withRedis(async (redis) => {
    await run(redis);
    return true;
  }, false);
}

/**
 * 一份「Redis 为主、进程内存为辅」的单键状态。
 *
 * 内存副本只是替补，不是第二份真相。四种情况：
 *
 * 1. Redis 不可达 —— 只能信内存副本。
 * 2. Redis 答了值 —— Redis 赢，刷新内存副本。唯一的例外是上次写没落进去
 *    （`persisted` 为假）且内存那份更新：Redis 停用窗里 set 会静默失败，等它
 *    恢复时里面还是故障前的旧值，无条件优先会把页面钉在旧状态上。
 * 3. Redis 答「没有」且我们写进去过 —— 是真被删了，内存跟着清。
 * 4. Redis 答「没有」且我们没写进去过 —— 写从来没成功，内存是唯一真相，留着。
 *
 * 已知缺陷（沿用旧行为，没修）：删除动作若落在 Redis 停用窗里，等恢复后旧值
 * 会从 Redis 复活。要根治得写墓碑，为这个场景不值当。
 */
export function mirrorKey<T>(
  parts: string[],
  /** 取「这份有多新」。用来在 Redis 写失败过时，挡住旧值把内存里的新值盖回去 */
  stampOf: (value: T) => number,
  { ttlMs }: { ttlMs?: number } = {},
) {
  const k = key(...parts);
  let memory: T | null = null;
  let persisted = false;

  return {
    async put(value: T): Promise<void> {
      memory = value;
      persisted = await tellRedis((redis) =>
        ttlMs ? redis.set(k, JSON.stringify(value), "PX", ttlMs) : redis.set(k, JSON.stringify(value)),
      );
    },

    async drop(): Promise<void> {
      memory = null;
      persisted = await tellRedis((redis) => redis.del(k));
    },

    async get(): Promise<T | null> {
      const answered = await askRedis((redis) => redis.get(k));
      if (!answered) return memory;

      if (answered.value) {
        let stored: T;
        try {
          stored = JSON.parse(answered.value) as T;
        } catch {
          // 脏数据按「答不上来」算，不按「没有」—— 否则会连累好好的内存副本
          return memory;
        }
        if (!persisted && memory && stampOf(memory) > stampOf(stored)) return memory;
        memory = stored;
        persisted = true;
        return stored;
      }

      if (persisted) {
        memory = null;
        return null;
      }
      return memory;
    },

    /** Redis 此刻答不答得上话。用来把「里面没有」和「问不到」在报错里分开 */
    async reachable(): Promise<boolean> {
      return (await askRedis(async () => true)) != null;
    },
  };
}
