import { StorageClient } from "@shared/storage-client";
import { currentContext } from "./runtime";

export { StorageClient };
export type { StorageBatch } from "@shared/storage-client";
export type StorageAnswer<T> = { reachable: true; value: T } | { reachable: false };

export function getStorage(): StorageClient {
  const context = currentContext();
  if (context.storage) return context.storage;
  const hub = context.env.STATE.get(context.env.STATE.idFromName("global"));
  return new StorageClient((commands) => hub.execute(commands));
}
export function key(...parts: string[]): string { return [process.env.STORAGE_PREFIX ?? "lyjwpage", ...parts].join(":"); }
export function withStorageScope<T>(run: () => Promise<T>): Promise<T> { return run(); }
/** Worker 持久化失败必须冒泡，让上报器重试，不能成功应答后只留进程内存。 */
export function withStorage<T>(run: (storage: StorageClient) => Promise<T>, fallback: T): Promise<T> { void fallback; return run(getStorage()); }
export async function askStorage<T>(load: (storage: StorageClient) => Promise<T>): Promise<StorageAnswer<T>> { return { reachable: true, value: await load(getStorage()) }; }
export async function tellStorage(run: (storage: StorageClient) => Promise<unknown>): Promise<boolean> { await run(getStorage()); return true; }
export function resetStorageDriverForTests(): void {}
/** 签名和 Node 驱动对齐，好让同一份测试在两套 tsconfig 下都成立；Worker 里注入没有意义。 */
export function installStorageForTests(client: StorageClient | null): never {
  void client;
  throw new Error("Use the Node test driver");
}
