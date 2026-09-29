import { key } from "@/lib/storage";
import type { PowerBankStatus } from "@/lib/types";

export const K_LATEST = key("powerbank", "latest");

export const K_LAST_PUSH = key("powerbank", "lastPush");

/** 同 shared/charger-store 的 `fallback`：只在 Worker 驱动之外（Node 测试驱动）SQLite 不可达时用到 */
export const fallback = {
  latest: null as PowerBankStatus | null,
  receivedAt: 0,
  lastPushAt: 0,
  persisted: false,
};

export type Stored = { status: PowerBankStatus; receivedAt: number };
