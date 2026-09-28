import type { LagEntry, LagKey } from "@shared/lag";

/**
 * 读可滞后层 KV 的一条（格式见 shared/lag.ts）。
 *
 * 站点不绑 KV，这里只能抛错；公开读取端点在 api Worker 上，由路径别名把
 * `@/lib/lag-store` 指到读 `LAG` 绑定的实现，和 `@/lib/storage-driver` 同一套做法。
 * 单元测试用 `installLagStoreForTests` 注入一份内存 KV。
 */
type LagReader = (key: LagKey) => Promise<LagEntry<unknown> | null>;

let injected: LagReader | null = null;

export function installLagStoreForTests(reader: LagReader | null): void {
  injected = reader;
}

export async function readLagEntry<T>(key: LagKey): Promise<LagEntry<T> | null> {
  if (injected) return (await injected(key)) as LagEntry<T> | null;
  throw new Error("可滞后层只在 Worker 上读取；站点不绑 KV");
}
