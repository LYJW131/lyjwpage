import { StorageClient } from "@shared/storage-client";
import type { StorageCommand } from "@shared/storage-contract";

import { currentEnv } from "./runtime";

export { StorageClient };
export type { StorageBatch } from "@shared/storage-client";
export type StorageAnswer<T> = { reachable: true; value: T } | { reachable: false };

/**
 * `@/lib/storage-driver` 在采集 Worker 里的实现：背后是 `COLLECTOR_KV`。
 *
 * 只为让 src/lib/cache（`get` / `put` / `cached` / `remove`）原样可用：
 * Apple 封面与时长缓存、GitHub 增删行的锚、PageSpeed 的样本窗口。所以只接
 * `get`、`set`（含 TTL 和 ifAbsent）和 `remove`；列表、哈希那几种操作 KV 没有对应，
 * 直接抛错，谁误用谁当场知道。
 *
 * 两处和 DO SQLite 不一样，调用方要心里有数：
 * - KV 的 TTL 最短 60 秒，更短的按 60 秒记（cache.ts 里更短的负缓存会活满一分钟）；
 * - `ifAbsent` 是先读后写，不是原子的，也不是锁：同一个任务可能被 cron 与
 *   `Collector.refresh` 同时触发，别拿它当互斥。KV 的读还有最长 60 秒的边缘缓存，
 *   所以两分钟以内要读回的值不走这里。
 *
 * 失败一律冒泡（和 api Worker 的驱动同一个口径）：KV 就是权威，不退回进程内存。
 */

/** KV 的最小子集；测试用内存替身 */
export interface KvLike {
  get(key: string, type: "text"): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

/** KV 的 expirationTtl 以秒计、最少 60 */
export function kvTtlSeconds(ttlMs: number): number {
  return Math.max(60, Math.ceil(ttlMs / 1000));
}

export function kvStorage(kv: KvLike): StorageClient {
  return new StorageClient(async (commands) => {
    const results: unknown[] = [];
    // 顺序执行：一批里后面的命令可能读前面刚写的键
    for (const command of commands) results.push(await run(kv, command));
    return results;
  });
}

async function run(kv: KvLike, command: StorageCommand): Promise<unknown> {
  switch (command.op) {
    case "get":
      return kv.get(command.key, "text");
    case "set": {
      if (command.options?.ifAbsent && (await kv.get(command.key, "text")) !== null) return false;
      const ttlMs = command.options?.ttlMs;
      await kv.put(command.key, command.value, ttlMs ? { expirationTtl: kvTtlSeconds(ttlMs) } : undefined);
      return true;
    }
    case "remove":
      await kv.delete(command.key);
      return 1;
    default:
      throw new Error(`采集 Worker 的 KV 存储不支持 ${command.op}`);
  }
}

export function getStorage(): StorageClient {
  return kvStorage(currentEnv().COLLECTOR_KV);
}

export function key(...parts: string[]): string {
  return [process.env.STORAGE_PREFIX ?? "lyjwpage", ...parts].join(":");
}
export function withStorageScope<T>(run: () => Promise<T>): Promise<T> {
  return run();
}
/** 持久化失败必须冒泡：cron 这一轮算失败，下一轮重来，不假装写进去了。 */
export function withStorage<T>(run: (storage: StorageClient) => Promise<T>, fallback: T): Promise<T> {
  void fallback;
  return run(getStorage());
}
export async function askStorage<T>(load: (storage: StorageClient) => Promise<T>): Promise<StorageAnswer<T>> {
  return { reachable: true, value: await load(getStorage()) };
}
export async function tellStorage(run: (storage: StorageClient) => Promise<unknown>): Promise<boolean> {
  await run(getStorage());
  return true;
}
export function resetStorageDriverForTests(): void {}
/** 签名和 Node 驱动对齐；这里注入没有意义，测试直接绑一个带内存 KV 的 env。 */
export function installStorageForTests(client: StorageClient | null): never {
  void client;
  throw new Error("Use bindEnv with an in-memory COLLECTOR_KV");
}
