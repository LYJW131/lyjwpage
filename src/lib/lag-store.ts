import type { LagEntry, LagKey } from "@shared/lag";

type LagReader = (key: LagKey) => Promise<LagEntry<unknown> | null>;

let injected: LagReader | null = null;

export function installLagStoreForTests(reader: LagReader | null): void {
  injected = reader;
}

export async function readLagEntry<T>(key: LagKey): Promise<LagEntry<T> | null> {
  if (injected) return (await injected(key)) as LagEntry<T> | null;
  throw new Error("可滞后层只在 Worker 上读取；站点不绑 KV");
}
