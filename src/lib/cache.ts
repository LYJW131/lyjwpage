import { requestState } from "@shared/request-state";
import { askStorage, key, tellStorage, withStorage } from "@/lib/storage";


type Entry = {
  value: unknown;
  expiresAt: number;
  persisted: boolean;
};

const memory = () => requestState("cache-memory", () => new Map<string, Entry>());
const inflightMap = () => requestState("cache-inflight", () => new Map<string, Promise<unknown>>());

const MEMORY_LIMIT = 500;

const NEGATIVE_TTL_MS = 5_000;
const NEGATIVE_PREFIX = "neg";

function memoryEntry(k: string): Entry | undefined {
  const hit = memory().get(k);
  if (!hit) return undefined;
  if (hit.expiresAt <= Date.now()) {
    memory().delete(k);
    return undefined;
  }
  return hit;
}

function memoryGet<T>(k: string): T | undefined {
  return memoryEntry(k)?.value as T | undefined;
}

function memorySet(k: string, value: unknown, ttlMs: number, persisted: boolean) {
  memory().delete(k);
  memory().set(k, { value, expiresAt: Date.now() + Math.max(1_000, ttlMs), persisted });
  while (memory().size > MEMORY_LIMIT) {
    const oldest = memory().keys().next().value;
    if (oldest === undefined) break;
    memory().delete(oldest);
  }
}

// 存储返回空值代表删除；只有不可达才可用内存，不能把已删除数据复活。
export async function get<T>(k: string): Promise<T | undefined> {
  const answer = await askStorage((storage) => storage.get(key("cache", k)));
  if (!answer.reachable) return memoryGet<T>(k);
  if (answer.value == null) {
    const local = memoryEntry(k);
    return local && !local.persisted ? (local.value as T) : undefined;
  }
  try {
    return JSON.parse(answer.value) as T;
  } catch {
    return undefined;
  }
}

export async function put<T>(k: string, value: T, ttlMs: number) {
  // 存储契约要求 TTL 是正整数（shared/storage-contract 的 validTtl）：带小数的 TTL
  // （比如按半衰期除出来的 x.5 毫秒）整条 set 都会被拒。约束在这层收口（向上取整，
  // 再设个下限），不指望每个调用方自己取整。
  const ttl = Math.max(1_000, Math.ceil(ttlMs));
  memorySet(k, value, ttl, false);
  const persisted = await tellStorage((storage) =>
    storage.set(key("cache", k), JSON.stringify(value), { ttlMs: ttl }),
  );
  if (persisted) memorySet(k, value, ttl, true);
}

export async function remove(k: string) {
  memory().delete(k);
  await withStorage(async (storage) => storage.remove(key("cache", k)), null);
}

export async function cached<T>(
  k: string,
  ttlMs: number,
  loader: () => Promise<T>,
): Promise<T> {
  const [hit, failure] = await Promise.all([
    get<T>(k),
    get<{ message: string }>(`${NEGATIVE_PREFIX}:${k}`),
  ]);
  if (hit !== undefined) return hit;
  if (failure) throw new Error(failure.message);

  const running = inflightMap().get(k);
  if (running) return running as Promise<T>;

  const promise = (async () => {
    try {
      const value = await loader();
      await put(k, value, ttlMs);
      return value;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      await put(`${NEGATIVE_PREFIX}:${k}`, { message: err.message }, NEGATIVE_TTL_MS);
      throw err;
    } finally {
      inflightMap().delete(k);
    }
  })();

  inflightMap().set(k, promise);
  return promise;
}
