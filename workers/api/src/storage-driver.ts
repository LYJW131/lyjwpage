import { StorageClient } from "@shared/storage-client";
import { STORAGE_MAX_COMMANDS, type StorageCommand, type StorageResult } from "@shared/storage-contract";
import { currentContext } from "./runtime";

export function stateStorage(): StorageClient {
  const context = currentContext();
  if (context.storage) return context.storage;
  const stub = () => context.env.STATE.get(context.env.STATE.idFromName("global"));
  let hub = stub();
  return new StorageClient((commands) => retryRead(commands, () => hub.execute(commands), () => { hub = stub(); }));
}

// DO 重置会抛 retryable；只重试读取，写入可能已提交，不能在这里重放。
export async function retryRead<T>(commands: readonly StorageCommand[], run: () => Promise<T>, renew?: () => void): Promise<T> {
  try {
    return await run();
  } catch (error) {
    const retryable = (error as { retryable?: unknown } | null)?.retryable === true;
    const overloaded = (error as { overloaded?: unknown } | null)?.overloaded === true;
    if (!retryable || overloaded || !readOnly(commands)) throw error;
    renew?.();
    return run();
  }
}

type PendingRead = {
  commands: StorageCommand[];
  resolve: (values: unknown[]) => void;
  reject: (error: unknown) => void;
};

function readOnly(commands: readonly StorageCommand[]): boolean {
  return commands.every((command) => command.op === "get" || command.op === "fields" || command.op === "listRange");
}

// 只合并独立读取；合并写事务会让一个操作的失败回滚相邻操作。
type PublicStorageHub = {
  publicRead(commands: StorageCommand[]): Promise<StorageResult[] | null>;
  execute(commands: StorageCommand[]): Promise<unknown[]>;
};

export class StorageNotReady extends Error {
  constructor() {
    super("State storage is not initialized");
    this.name = "StorageNotReady";
  }
}

export function createPublicStorage(
  hub: PublicStorageHub,
  renewHub?: () => PublicStorageHub,
  onNotReady?: () => void,
): StorageClient {
  const renew = renewHub && (() => { hub = renewHub(); });
  const read = async (commands: StorageCommand[]): Promise<StorageResult[]> => {
    const values = await retryRead(commands, () => hub.publicRead(commands), renew);
    if (values) return values;
    onNotReady?.();
    throw new StorageNotReady();
  };
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
          const commands = group.flatMap((item) => item.commands);
          const values = await read(commands);
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
            const values = readOnly(commands) ? await read(commands) : await hub.execute(commands);
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
