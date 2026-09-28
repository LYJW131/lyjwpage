import { readLag, type LagEntry, type LagKey } from "@shared/lag";
import { currentContext } from "./runtime";

/**
 * `@/lib/lag-store` 在 api Worker 里的实现：公开读取端点只读 `LAG`，不写。
 * 没绑 KV 的环境（分支 Preview）读不到，端点回 ok:false，由上游兜底补上。
 */
export async function readLagEntry<T>(key: LagKey): Promise<LagEntry<T> | null> {
  const kv = currentContext().env.LAG;
  return kv ? readLag<T>(kv, key) : null;
}

/** 站点侧同名模块给单元测试留的注入口；Worker 里读真 KV，不需要 */
export function installLagStoreForTests(): void {}
