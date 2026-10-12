import { StorageClient } from "@shared/storage-client";
import type { StorageCommand } from "@shared/storage-contract";

import { currentEnv } from "./runtime";

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

export function collectorStorage(): StorageClient {
  return kvStorage(currentEnv().COLLECTOR_KV);
}
