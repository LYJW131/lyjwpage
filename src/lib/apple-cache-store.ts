export type AppleCacheKv = {
  get(key: string, type: "text"): Promise<string | null>;
  put(key: string, value: string, options: { expirationTtl: number }): Promise<void>;
  delete(key: string): Promise<void>;
};

let injected: AppleCacheKv | null = null;

export function installAppleCacheForTests(kv: AppleCacheKv | null): void {
  injected = kv;
}

export function appleCacheKv(): AppleCacheKv | null {
  return injected;
}
