import { StorageClient } from "@shared/storage-client";
import { STORAGE_MAX_COMMANDS, type StorageCommand, type StorageResult } from "@shared/storage-contract";
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

type PendingRead = {
  commands: StorageCommand[];
  resolve: (values: unknown[]) => void;
  reject: (error: unknown) => void;
};

function readOnly(commands: readonly StorageCommand[]): boolean {
  return commands.every((command) => command.op === "get" || command.op === "fields" || command.op === "listRange");
}

/**
 * Coalesce only independent reads started in the same request turn. Each flush is
 * one StateHub transaction and its result slices retain the callers' ordering.
 * Writes keep their original RPC/transaction boundary so failures cannot spread
 * into an adjacent operation.
 */
type PublicStorageHub = {
  publicRead(commands: StorageCommand[]): Promise<StorageResult[]>;
  execute(commands: StorageCommand[]): Promise<unknown[]>;
};

export function createPublicStorage(hub: PublicStorageHub): StorageClient {
  let pending: PendingRead[] = [];
  let scheduled = false;
  let tail = Promise.resolve();

  function enqueue(run: () => Promise<void>): void {
    tail = tail.then(run, run);
  }

  function flush(): void {
    scheduled = false;
    const reads = pending;
    pending = [];
    if (!reads.length) return;
    enqueue(async () => {
      for (let offset = 0; offset < reads.length;) {
        const group: PendingRead[] = [];
        let commandCount = 0;
        while (offset < reads.length) {
          const next = reads[offset];
          if (!next || (group.length > 0 && commandCount + next.commands.length > STORAGE_MAX_COMMANDS)) break;
          group.push(next);
          commandCount += next.commands.length;
          offset += 1;
        }
        try {
          const values: StorageResult[] = await hub.publicRead(group.flatMap((item) => item.commands));
          let valueOffset = 0;
          for (const item of group) {
            item.resolve(values.slice(valueOffset, valueOffset + item.commands.length));
            valueOffset += item.commands.length;
          }
        } catch (error) {
          for (const item of group) item.reject(error);
        }
      }
    });
  }

  return new StorageClient((commands) => {
    if (!readOnly(commands) || commands.length > STORAGE_MAX_COMMANDS) {
      flush();
      return new Promise<unknown[]>((resolve, reject) => {
        enqueue(async () => {
          try {
            const values = readOnly(commands) ? await hub.publicRead(commands) : await hub.execute(commands);
            resolve(values);
          } catch (error) { reject(error); }
        });
      });
    }
    return new Promise<unknown[]>((resolve, reject) => {
      pending.push({ commands, resolve, reject });
      if (!scheduled) {
        scheduled = true;
        queueMicrotask(flush);
      }
    });
  });
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
