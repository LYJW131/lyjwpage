import { key } from "@shared/storage";
import type { ReportedPowerBankStatus } from "@shared/types";

export const K_LATEST = key("powerbank", "latest");

export const K_LAST_PUSH = key("powerbank", "lastPush");

export type Stored = { status: ReportedPowerBankStatus; receivedAt: number };
