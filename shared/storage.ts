import { StorageClient } from "@shared/storage-client";

export { StorageClient };
export type { StorageBatch } from "@shared/storage-client";

let provider: (() => StorageClient) | null = null;

export function installStorage(next: (() => StorageClient) | null): void {
  provider = next;
}

export function getStorage(): StorageClient {
  if (!provider) throw new Error("存储没有装上：Worker 入口先调 installStorage");
  return provider();
}

export function key(...parts: string[]): string {
  return [process.env.STORAGE_PREFIX ?? "lyjwpage", ...parts].join(":");
}

function parsed<T>(raw: string): T | null {
  try { return JSON.parse(raw) as T; }
  catch { return null; }
}

export function mirrorKey<T>(parts: string[], { ttlMs }: { ttlMs?: number } = {}) {
  const k = key(...parts);
  return {
    key: k,
    async put(value: T): Promise<void> {
      await getStorage().set(k, JSON.stringify(value), ttlMs ? { ttlMs } : undefined);
    },
    async drop(): Promise<void> {
      await getStorage().remove(k);
    },
    async get(): Promise<T | null> {
      const raw = await getStorage().get(k);
      return raw === null ? null : parsed<T>(raw);
    },
  };
}

export function fieldMirror<T extends object>(parts: string[]) {
  const k = key(...parts);
  return {
    async merge(incoming: T, fields: readonly (keyof T & string)[]): Promise<void> {
      const values = Object.fromEntries(fields.map((field) => [field, JSON.stringify(incoming[field] ?? null)]));
      await getStorage().batch().patch(k, values).execute();
    },
    async get(): Promise<T | null> {
      const fields = (await getStorage().batch().fields(k).execute())[0] as Record<string, string>;
      if (!Object.keys(fields).length) return null;
      try {
        return Object.fromEntries(Object.entries(fields).map(([field, value]) => [field, JSON.parse(value)])) as T;
      } catch {
        return null;
      }
    },
  };
}
