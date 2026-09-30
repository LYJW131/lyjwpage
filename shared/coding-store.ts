import { key } from "@/lib/storage";
import type { CodingNowPayload, CodingUsagePayload } from "@/lib/types";

import type { CodingActivityReport } from "./coding-usage";
import type { CodingUsageSource } from "./coding-usage-sources";
import type { CodingUsageYearView, StoredCodingUsageAgent } from "./coding-usage-view";


export const codingUsageKey = (source: CodingUsageSource) => key("coding", "usage", source);
export const codingViewKey = () => key("coding", "usage", "view");
export const codingYearKey = () => key("coding", "usage", "year");
export const codingActivityKey = (source: CodingUsageSource) => key("coding", "activity", source);
export const codingPushedNowKey = () => key("coding", "now", "pushed");
export const codingOtlpKey = () => key("coding", "otlp");
export const codingBucketsKey = (source: CodingUsageSource) => key("pulse", "token-buckets", source);
// 时刻可能在乱序提交后不变；归档增量水位必须用与账本同事务递增的修订号。
export const codingUsageRevisionKey = () => key("coding", "usage", "revision");
export const codingBucketsRevisionKey = () => key("pulse", "token-buckets", "revision");

export function parseRevision(raw: unknown): number {
  const value = typeof raw === "string" ? Number(raw) : Number.NaN;
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

export type StoredCodingActivity = CodingActivityReport & { receivedAt: number };

// 会话摘要会过期，累计 sessionCount 不能随摘要删除而减少。
export type StoredOtlpCounters = {
  series: Record<string, { value: number; seenAt: number }>;
  sessions: Record<string, number>;
  sessionCount: number;
};

function json(raw: unknown): Record<string, unknown> | null {
  if (typeof raw !== "string") return null;
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function parseStoredUsageLedgers(fields: unknown): Record<string, StoredCodingUsageAgent> {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return {};
  const ledgers: Record<string, StoredCodingUsageAgent> = {};
  for (const [id, raw] of Object.entries(fields as Record<string, unknown>)) {
    const row = json(raw);
    if (row && row.id === id && Array.isArray(row.days) && (row.state === "ok" || row.state === "error")) {
      ledgers[id] = row as StoredCodingUsageAgent;
    }
  }
  return ledgers;
}

export function parseStoredActivity(raw: unknown): StoredCodingActivity | null {
  const row = json(raw);
  return row && typeof row.collectedAt === "number" && Array.isArray(row.agents) ? row as StoredCodingActivity : null;
}

export function parseStoredPushedNow(raw: unknown): CodingNowPayload["agents"] {
  if (typeof raw !== "string") return [];
  try {
    const value: unknown = JSON.parse(raw);
    return Array.isArray(value) && value.every((agent) => agent && typeof agent.id === "string" && Array.isArray(agent.activity))
      ? value as CodingNowPayload["agents"]
      : [];
  } catch {
    return [];
  }
}

export function parseStoredView(raw: unknown): CodingUsagePayload | null {
  const row = json(raw);
  return row && Array.isArray(row.agents) && Array.isArray(row.topModels) ? row as CodingUsagePayload : null;
}

export function parseStoredYear(raw: unknown): CodingUsageYearView | null {
  const row = json(raw);
  return row && typeof row.updatedAt === "number" && row.days && typeof row.days === "object" ? row as CodingUsageYearView : null;
}

export function parseOtlpCounters(raw: unknown): StoredOtlpCounters | null {
  const row = json(raw);
  if (!row || !row.series || typeof row.series !== "object" || !row.sessions || typeof row.sessions !== "object") return null;
  return {
    series: row.series as StoredOtlpCounters["series"],
    sessions: row.sessions as StoredOtlpCounters["sessions"],
    sessionCount: typeof row.sessionCount === "number" ? row.sessionCount : Object.keys(row.sessions).length,
  };
}
