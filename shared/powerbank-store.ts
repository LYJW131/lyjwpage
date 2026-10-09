import { key } from "@/lib/storage";
import type { ReportedPowerBankStatus } from "@/lib/types";

export const K_LATEST = key("powerbank", "latest");

export const K_LAST_PUSH = key("powerbank", "lastPush");

export const fallback = {
  latest: null as ReportedPowerBankStatus | null,
  receivedAt: 0,
  lastPushAt: 0,
  persisted: false,
};

export type Stored = { status: ReportedPowerBankStatus; receivedAt: number };
