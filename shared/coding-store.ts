import { key } from "@/lib/storage";
import type { CodingUsagePayload } from "@/lib/types";

import type { CodingActivityReport } from "./coding-usage";
import type { CodingUsageSource } from "./coding-usage-sources";
import type { CodingUsageYearView, StoredCodingUsageAgent } from "./coding-usage-view";

/**
 * coding 用量在状态核心（DO）里的键。写入方只有状态核心的三个 store（workers/api/src/stores/coding-*），
 * 读出口（src/lib/coding-usage）与 Pulse（src/lib/pulse）只读。
 *
 * | 键 | 形状 |
 * | --- | --- |
 * | `coding:usage:<来源>` | 字段哈希，字段 = agent id，值 = `StoredCodingUsageAgent` |
 * | `coding:usage:view` | `CodingUsagePayload`（和钟无关的全历史聚合） |
 * | `coding:usage:year` | `CodingUsageYearView`（最近 380 天，每天合计与模型前五） |
 * | `coding:activity:<来源>` | `StoredCodingActivity` |
 * | `coding:otlp` | `StoredOtlpCounters`（云端 OTLP 累计值做差用的计数器） |
 * | `pulse:token-buckets:<来源>` | `StoredCodingBuckets`（shared/coding-buckets），TTL 2 天 |
 */

export const codingUsageKey = (source: CodingUsageSource) => key("coding", "usage", source);
export const codingViewKey = () => key("coding", "usage", "view");
export const codingYearKey = () => key("coding", "usage", "year");
export const codingActivityKey = (source: CodingUsageSource) => key("coding", "activity", source);
export const codingOtlpKey = () => key("coding", "otlp");
export const codingBucketsKey = (source: CodingUsageSource) => key("pulse", "token-buckets", source);

/** 一个来源最近一封活动报告，外加状态核心收到它的时刻 */
export type StoredCodingActivity = CodingActivityReport & { receivedAt: number };

/**
 * 云端 OTLP 的计数器：每条累计序列上次的值（做差用），见过的会话摘要（数会话用）。
 * `sessionCount` 是一直往上加的累计数：会话摘要只记 30 天，记录删了数不能跟着掉。
 */
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

/** 状态核心自己写的值，读回来只挡坏行：形状不对就当没有 */
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
