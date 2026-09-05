import type { InjectedPipeline, InjectedRedis } from "@/lib/redis";

type StringRecord = { value: string; expiresAt?: number };

/**
 * 内存 Redis。只覆盖 redis.ts / mirrorKey / overlayHashKey 会调到的那几个方法。
 * `setUnreachable()` 让命令抛错，用来测 UNREACHABLE 回退。
 */
export class FakeRedis implements InjectedRedis {
  private unreachable = false;
  private strings = new Map<string, StringRecord>();
  private hashes = new Map<string, Map<string, string>>();

  setUnreachable(value = true): void {
    this.unreachable = value;
  }

  disconnect(): void {
    // 租约每次 operation 结束都会 disconnect。数据必须留着，好被 getRedis 再次 use。
  }

  async get(key: string): Promise<string | null> {
    this.failIfUnreachable();
    this.purgeExpired(key);
    return this.strings.get(key)?.value ?? null;
  }

  async set(key: string, value: string, ...args: unknown[]): Promise<"OK"> {
    this.failIfUnreachable();
    const record: StringRecord = { value: String(value) };
    if (args[0] === "PX") {
      const ms = Number(args[1]);
      if (Number.isFinite(ms)) record.expiresAt = Date.now() + ms;
    }
    this.strings.set(key, record);
    this.hashes.delete(key);
    return "OK";
  }

  async del(key: string): Promise<number> {
    this.failIfUnreachable();
    const had = this.strings.delete(key) || this.hashes.delete(key);
    return had ? 1 : 0;
  }

  async hset(key: string, object: object): Promise<number> {
    this.failIfUnreachable();
    let hash = this.hashes.get(key);
    if (!hash) {
      hash = new Map();
      this.hashes.set(key, hash);
    }
    this.strings.delete(key);
    let added = 0;
    for (const [field, fieldValue] of Object.entries(object)) {
      if (!hash.has(field)) added += 1;
      hash.set(field, String(fieldValue));
    }
    return added;
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    this.failIfUnreachable();
    const hash = this.hashes.get(key);
    if (!hash) return {};
    return Object.fromEntries(hash);
  }

  pipeline(): InjectedPipeline {
    const commands: Array<() => Promise<unknown>> = [];
    const pipe: InjectedPipeline = {
      hset: (key, object) => {
        commands.push(() => this.hset(key, object));
        return pipe;
      },
      hgetall: (key) => {
        commands.push(() => this.hgetall(key));
        return pipe;
      },
      get: (key) => {
        commands.push(() => this.get(key));
        return pipe;
      },
      exec: async () => {
        this.failIfUnreachable();
        const rows: [Error | null, unknown][] = [];
        for (const command of commands) {
          try {
            rows.push([null, await command()]);
          } catch (error) {
            rows.push([error instanceof Error ? error : new Error(String(error)), null]);
          }
        }
        return rows;
      },
    };
    return pipe;
  }

  private failIfUnreachable(): void {
    if (this.unreachable) throw new Error("fake redis unreachable");
  }

  private purgeExpired(key: string): void {
    const record = this.strings.get(key);
    if (record?.expiresAt != null && record.expiresAt <= Date.now()) {
      this.strings.delete(key);
    }
  }
}
