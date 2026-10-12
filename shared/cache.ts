import { requestState } from "@shared/request-state";
import { getStorage, key } from "@shared/storage";

const inflightMap = () => requestState("cache-inflight", () => new Map<string, Promise<unknown>>());

const NEGATIVE_TTL_MS = 5_000;
const NEGATIVE_PREFIX = "neg";

export async function get<T>(k: string): Promise<T | undefined> {
  const raw = await getStorage().get(key("cache", k));
  if (raw == null) return undefined;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export async function put<T>(k: string, value: T, ttlMs: number) {
  // 存储契约要求 TTL 是正整数（shared/storage-contract 的 validTtl）：带小数的 TTL
  // （比如按半衰期除出来的 x.5 毫秒）整条 set 都会被拒。约束在这层收口（向上取整，
  // 再设个下限），不指望每个调用方自己取整。
  const ttl = Math.max(1_000, Math.ceil(ttlMs));
  await getStorage().set(key("cache", k), JSON.stringify(value), { ttlMs: ttl });
}

export async function remove(k: string) {
  await getStorage().remove(key("cache", k));
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
