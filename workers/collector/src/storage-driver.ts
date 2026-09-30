import { StorageClient } from "@shared/storage-client";
import type { StorageCommand } from "@shared/storage-contract";

import { currentEnv } from "./runtime";

export { StorageClient };
export type { StorageBatch } from "@shared/storage-client";
export type StorageAnswer<T> = { reachable: true; value: T } | { reachable: false };

// KV 的 ifAbsent 先读后写且读取最终一致，不能用作锁，也不保证写后立即读到。

export interface KvLike {
  get(key: string, type: "text"): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

// KV 不接受短于一分钟的 expirationTtl。
export function kvTtlSeconds(ttlMs: number): number {
  return Math.max(60, Math.ceil(ttlMs / 1000));
}

export function kvStorage(kv: KvLike): StorageClient {
  return new StorageClient(async (commands) => {
    const results: unknown[] = [];
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
export function installStorageForTests(client: StorageClient | null): never {
  void client;
  throw new Error("Use bindEnv with an in-memory COLLECTOR_KV");
}
