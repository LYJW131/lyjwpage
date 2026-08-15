import Redis from "ioredis";

import { ConnectionLeases } from "@/lib/connection-leases";

/**
 * Redis 连接。没配 REDIS_URL 就返回 null，各处缓存自动退回进程内存 ——
 * 本地开发不装 Redis 也能跑，线上 Redis 挂掉也只是丢缓存，不会让页面 500。
 */

const PREFIX = process.env.REDIS_PREFIX ?? "lyjwpage";

/** 连不上时先停用一段时间，避免每次请求都卡在重连上 */
const DISABLE_MS = 30_000;

type RedisState = {
  leases: ConnectionLeases<Redis>;
  disabledUntil: number;
};

/**
 * 挂 globalThis，保证同一 Node 实例里被不同 Next bundle 引到时仍共用一条连接。
 * 连接本身不永久挂着：最后一个请求 / 命令结束后由租约主动断开。
 */
const state = ((globalThis as typeof globalThis & { __lyjwRedis?: RedisState }).__lyjwRedis ??= {
  leases: new ConnectionLeases<Redis>(),
  disabledUntil: 0,
});

function connectionName(): string {
  const environment = process.env.VERCEL_ENV ?? "local";
  const sha = process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local";
  const region = process.env.VERCEL_REGION ?? "local";
  return `lyjwpage:${environment}:${sha}:${region}`;
}

export function getRedis(): Redis | null {
  if (Date.now() < state.disabledUntil) return null;

  const current = state.leases.current();
  if (current) return current;

  const url = process.env.REDIS_URL;
  if (!url) return null;

  const client = state.leases.use(
    new Redis(url, {
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
      connectionName: connectionName(),
    }),
  );

  client.on("error", (error) => {
    if (Date.now() >= state.disabledUntil) console.error("[redis]", error.message);
    state.disabledUntil = Date.now() + DISABLE_MS;
    // 业务停用时必须同时关 socket；否则 ioredis 仍会在后台自动重连、继续占槽。
    state.leases.disconnect(client);
  });

  return client;
}

/**
 * 一次请求或一次缓存重建共用同一条连接；嵌套和 Fluid 同实例并发都安全。
 * 最后一个 scope 与命令结束后立即断开，不靠 serverless 暂停时不会跑的 idle timer。
 */
export function withRedisScope<T>(run: () => Promise<T>): Promise<T> {
  return state.leases.scope(run);
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
  try {
    return await state.leases.operation(getRedis, run, fallback);
  } catch (error) {
    console.error("[redis]", error instanceof Error ? error.message : String(error));
    return fallback;
  }
}

/** Redis 不可达时的应答。模块级常量，不是每次新建的字面量 */
const UNREACHABLE = { reachable: false } as const;

export type RedisAnswer<T> = { reachable: true; value: T } | typeof UNREACHABLE;

/**
 * 问一次 Redis，把「它说没有」和「它答不上来」分开。
 *
 * `reachable: false` 表示 Redis 不可达 —— 没配 REDIS_URL、连不上、或正落在
 * 出错后那 30 秒停用窗里。包一层才能和「Redis 好好答了，值就是 null」区分：
 * 直接用 `withRedis(get, null)` 的话这两种情况在外面长得一模一样，只能一律
 * 退回进程内存副本，于是清空 Redis 之后数据还从内存里活着。实测踩到过。
 *
 * 为什么用判别字段而不是「返回 null 表示不可达」：Turbopack 会内联分析同一
 * 模块内的调用，只跟到 `return await run(redis)` 这条返回对象字面量的路径，
 * 就断定结果恒为真，把调用方的 `if (!answered)` 整个当成死代码删掉 —— 编译
 * 产物里是 `if ("TURBOPACK compile-time falsy", 0)`。tsc 全绿、跨模块调用也
 * 正常，只有同模块的 mirrorKey 中招，Redis 一断就抛
 * 「Cannot read properties of null」。两条返回路径都给对象就没有这个可乘之机。
 */
export async function askRedis<T>(
  load: (redis: Redis) => Promise<T>,
): Promise<RedisAnswer<T>> {
  return withRedis<RedisAnswer<T>>(
    async (redis) => ({ reachable: true, value: await load(redis) }),
    UNREACHABLE,
  );
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
  /**
   * 内存副本挂 globalThis，不用模块作用域的变量。
   *
   * Next 的 dev server 里每个路由各有一份模块实例：写进 ingest 那份的内存，
   * status 那份看不见。于是 Redis 一断，读的一侧发现自己手上什么都没有，
   * 就把状态当成空的 —— 实测就是这样，停掉 Redis 后前台应用直接归零，而
   * 规则 1 本该让它继续供数。
   *
   * 这个坑代码库里早有先例：telemetryState 和 reporterLiveness 都是为此挂的
   * globalThis，只是新写的镜像没跟上。
   */
  const cells = ((globalThis as typeof globalThis & {
    __lyjwMirrors?: Map<string, { memory: unknown; persisted: boolean }>;
  }).__lyjwMirrors ??= new Map());
  let cell = cells.get(k);
  if (!cell) {
    cell = { memory: null, persisted: false };
    cells.set(k, cell);
  }
  const state = cell as { memory: T | null; persisted: boolean };

  return {
    async put(value: T): Promise<void> {
      state.memory = value;
      state.persisted = await tellRedis((redis) =>
        ttlMs ? redis.set(k, JSON.stringify(value), "PX", ttlMs) : redis.set(k, JSON.stringify(value)),
      );
    },

    async drop(): Promise<void> {
      state.memory = null;
      state.persisted = await tellRedis((redis) => redis.del(k));
    },

    async get(): Promise<T | null> {
      const answered = await askRedis((redis) => redis.get(k));
      if (!answered.reachable) return state.memory;

      if (answered.value) {
        let stored: T;
        try {
          stored = JSON.parse(answered.value) as T;
        } catch {
          // 脏数据按「答不上来」算，不按「没有」—— 否则会连累好好的内存副本
          return state.memory;
        }
        if (!state.persisted && state.memory && stampOf(state.memory) > stampOf(stored)) {
          return state.memory;
        }
        state.memory = stored;
        state.persisted = true;
        return stored;
      }

      if (state.persisted) {
        state.memory = null;
        return null;
      }
      return state.memory;
    },

    /** Redis 此刻答不答得上话。用来把「里面没有」和「问不到」在报错里分开 */
    async reachable(): Promise<boolean> {
      return (await askRedis(async () => true)).reachable;
    },
  };
}

function overlayHashBlob<T extends object>(
  hash: Record<string, string>,
  blob: string | null,
): T | null {
  let base: Record<string, unknown> | null = null;
  if (blob) {
    try {
      const parsed: unknown = JSON.parse(blob);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        base = parsed as Record<string, unknown>;
      }
    } catch {
      if (Object.keys(hash).length === 0) throw new Error("dirty blob");
    }
  }

  const fields = Object.keys(hash);
  if (fields.length === 0) return (base as T | null) ?? null;

  const next: Record<string, unknown> = { ...(base ?? {}) };
  for (const field of fields) {
    next[field] = JSON.parse(hash[field]!);
  }
  return next as T;
}

function patchHash<T extends object>(base: T | null, incoming: T, fields: readonly (keyof T & string)[]): T {
  const next = { ...(base ?? incoming) } as T;
  for (const field of fields) next[field] = incoming[field];
  return next;
}

function hashFieldValues<T extends object>(
  incoming: T,
  fields: readonly (keyof T & string)[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const field of fields) {
    out[field] = JSON.stringify(incoming[field] ?? null);
  }
  return out;
}

/**
 * 字段级镜像。每个字段一份 JSON，HSET 只动列出的那些键。
 *
 * 遥测信封按模块到：换歌只带 appleMusic，心跳只带存活。从前整包 SET，后到的
 * 心跳会把 Redis 里刚写进去的正在播盖回上一首 —— 推送用的是内存，刷新 /now
 * 读的是 Redis，于是页面先翻到新歌、一刷新又回去。
 *
 * 旧的整包 JSON（`blobParts`）只读不写，用来补齐还没按字段落过的模块。
 */
export function overlayHashKey<T extends object>(
  hashParts: string[],
  blobParts: string[],
  stampOf: (value: T) => number,
) {
  const hashK = key(...hashParts);
  const blobK = key(...blobParts);
  const cells = ((globalThis as typeof globalThis & {
    __lyjwMirrors?: Map<string, { memory: unknown; persisted: boolean }>;
  }).__lyjwMirrors ??= new Map());
  let cell = cells.get(hashK);
  if (!cell) {
    cell = { memory: null, persisted: false };
    cells.set(hashK, cell);
  }
  const state = cell as { memory: T | null; persisted: boolean };

  return {
    async merge(incoming: T, fields: readonly (keyof T & string)[]): Promise<void> {
      state.persisted = await tellRedis(async (redis) => {
        const rows = await redis
          .multi()
          .hset(hashK, hashFieldValues(incoming, fields))
          .hgetall(hashK)
          .get(blobK)
          .exec();
        if (!rows) throw new Error("telemetry hash merge discarded");
        const hashRow = rows[1];
        const blobRow = rows[2];
        if (!hashRow || !blobRow) throw new Error("telemetry hash merge incomplete");
        if (hashRow[0]) throw hashRow[0];
        if (blobRow[0]) throw blobRow[0];
        state.memory = overlayHashBlob<T>(
          hashRow[1] as Record<string, string>,
          blobRow[1] as string | null,
        );
      });
      if (!state.persisted) state.memory = patchHash(state.memory, incoming, fields);
    },

    async get(): Promise<T | null> {
      const answered = await askRedis(async (redis) => {
        const rows = await redis.multi().hgetall(hashK).get(blobK).exec();
        if (!rows) return { hash: {} as Record<string, string>, blob: null as string | null };
        const hashRow = rows[0];
        const blobRow = rows[1];
        if (!hashRow || !blobRow) return { hash: {} as Record<string, string>, blob: null as string | null };
        if (hashRow[0]) throw hashRow[0];
        if (blobRow[0]) throw blobRow[0];
        return {
          hash: hashRow[1] as Record<string, string>,
          blob: blobRow[1] as string | null,
        };
      });
      if (!answered.reachable) return state.memory;

      let stored: T | null;
      try {
        stored = overlayHashBlob<T>(answered.value.hash, answered.value.blob);
      } catch {
        return state.memory;
      }

      if (stored) {
        if (!state.persisted && state.memory && stampOf(state.memory) > stampOf(stored)) {
          return state.memory;
        }
        state.memory = stored;
        state.persisted = true;
        return stored;
      }

      if (state.persisted) {
        state.memory = null;
        return null;
      }
      return state.memory;
    },
  };
}
