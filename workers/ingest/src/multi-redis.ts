import type { RedisClient, RedisPipeline } from "../../../src/lib/redis-driver";

/** 解析逗号分隔的 REDIS_URL 列表。 */
export function parseRedisUrls(raw: string | undefined | null): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * 多 Redis 客户端代理（主从/双写）。
 *
 * 第 1 个为主库（Primary）：承担所有读操作（get / lrange，以及 pipeline 里的
 * hgetall / get），作为唯一权威结果返回。
 * 第 2 个及后续为镜像库（Mirrors）：只在写入（set / del / pipeline 写命令）时
 * 并发复制。只读 pipeline 不碰镜像，避免跨海读拖住上报响应。
 * pipeline.hset 在镜像上先 DEL 再 HSET，避免上次失败留下的旧域盖住后续整包 blob。
 * 镜像库失败仅记录日志，不阻断主流程。
 */
export class MultiWorkerRedis implements RedisClient {
  readonly primary: RedisClient;
  readonly mirrors: readonly RedisClient[];

  constructor(clients: RedisClient[]) {
    if (!clients.length) throw new Error("至少需要一个 Redis 客户端");
    this.primary = clients[0]!;
    this.mirrors = clients.slice(1);
  }

  get(key: string): Promise<string | null> {
    return this.primary.get(key);
  }

  async set(key: string, value: string, ...args: (string | number)[]): Promise<unknown> {
    const [primaryResult] = await Promise.all([
      this.primary.set(key, value, ...args),
      ...this.mirrors.map((m) =>
        m.set(key, value, ...args).catch((error) => {
          console.error("[redis:mirror] set 失败", error instanceof Error ? error.message : String(error));
          return null;
        }),
      ),
    ]);
    return primaryResult;
  }

  async del(key: string): Promise<number> {
    const [primaryResult] = await Promise.all([
      this.primary.del(key),
      ...this.mirrors.map((m) =>
        m.del(key).catch((error) => {
          console.error("[redis:mirror] del 失败", error instanceof Error ? error.message : String(error));
          return 0;
        }),
      ),
    ]);
    return primaryResult;
  }

  lrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.primary.lrange(key, start, stop);
  }

  pipeline(): RedisPipeline {
    const primaryPipe = this.primary.pipeline();
    const mirrorPipes = this.mirrors.map((m) => m.pipeline());
    let mirrorHasWrites = false;

    const writeToMirrors = (apply: (pipe: RedisPipeline) => void) => {
      mirrorHasWrites = true;
      for (const m of mirrorPipes) apply(m);
    };

    const pipe: RedisPipeline = {
      set: (key, value, ...args) => {
        primaryPipe.set(key, value, ...args);
        writeToMirrors((m) => m.set(key, value, ...args));
        return pipe;
      },
      del: (key) => {
        primaryPipe.del(key);
        writeToMirrors((m) => m.del(key));
        return pipe;
      },
      rpush: (key, ...values) => {
        primaryPipe.rpush(key, ...values);
        writeToMirrors((m) => m.rpush(key, ...values));
        return pipe;
      },
      ltrim: (key, start, stop) => {
        primaryPipe.ltrim(key, start, stop);
        writeToMirrors((m) => m.ltrim(key, start, stop));
        return pipe;
      },
      pexpire: (key, ms) => {
        primaryPipe.pexpire(key, ms);
        writeToMirrors((m) => m.pexpire(key, ms));
        return pipe;
      },
      hset: (key, object) => {
        primaryPipe.hset(key, object);
        // 镜像上先清掉整份 hash 再写入本轮字段：overlay 读会让每个 hash 域盖住
        // blob，换歌那次 HSET 若被吞掉，心跳只带时间戳，旧 music 会一直压住新歌。
        writeToMirrors((m) => {
          m.del(key);
          m.hset(key, object);
        });
        return pipe;
      },
      hgetall: (key) => {
        primaryPipe.hgetall(key);
        return pipe;
      },
      get: (key) => {
        primaryPipe.get(key);
        return pipe;
      },
      exec: async () => {
        const [primaryResult] = await Promise.all([
          primaryPipe.exec(),
          ...(mirrorHasWrites
            ? mirrorPipes.map((m) =>
                m.exec().catch((error) => {
                  console.error("[redis:mirror] pipeline 失败", error instanceof Error ? error.message : String(error));
                  return null;
                }),
              )
            : []),
        ]);
        return primaryResult;
      },
    };
    return pipe;
  }

  disconnect(): void {
    this.primary.disconnect();
    for (const m of this.mirrors) {
      try {
        m.disconnect();
      } catch {}
    }
  }
}
