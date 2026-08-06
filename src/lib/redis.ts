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
