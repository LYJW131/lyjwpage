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
 * 第 1 个为主库（Primary）：承担所有读操作（get / lrange），作为唯一权威结果返回。
 * 第 2 个及后续为镜像库（Mirrors）：在上报写入（set / del / pipeline）时并发复制。
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

    const pipe: RedisPipeline = {
      set: (key, value, ...args) => {
        primaryPipe.set(key, value, ...args);
        for (const m of mirrorPipes) m.set(key, value, ...args);
        return pipe;
      },
      del: (key) => {
        primaryPipe.del(key);
        for (const m of mirrorPipes) m.del(key);
        return pipe;
      },
      rpush: (key, ...values) => {
        primaryPipe.rpush(key, ...values);
        for (const m of mirrorPipes) m.rpush(key, ...values);
        return pipe;
      },
      ltrim: (key, start, stop) => {
        primaryPipe.ltrim(key, start, stop);
        for (const m of mirrorPipes) m.ltrim(key, start, stop);
        return pipe;
      },
      pexpire: (key, ms) => {
        primaryPipe.pexpire(key, ms);
        for (const m of mirrorPipes) m.pexpire(key, ms);
        return pipe;
      },
      hset: (key, object) => {
        primaryPipe.hset(key, object);
        for (const m of mirrorPipes) m.hset(key, object);
        return pipe;
      },
      hgetall: (key) => {
        primaryPipe.hgetall(key);
        for (const m of mirrorPipes) m.hgetall(key);
        return pipe;
      },
      get: (key) => {
        primaryPipe.get(key);
        for (const m of mirrorPipes) m.get(key);
        return pipe;
      },
      exec: async () => {
        const [primaryResult] = await Promise.all([
          primaryPipe.exec(),
          ...mirrorPipes.map((m) =>
            m.exec().catch((error) => {
              console.error("[redis:mirror] pipeline 失败", error instanceof Error ? error.message : String(error));
              return null;
            }),
          ),
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
