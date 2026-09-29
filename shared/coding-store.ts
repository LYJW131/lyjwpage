import { key } from "@/lib/storage";
import type { CodingNowPayload, CodingUsagePayload } from "@/lib/types";

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
 * | `coding:usage:revision` | 账本修订号：哪一次提交改了日子就加一，改到的账本记下这个值（D1 归档按它取增量） |
 * | `coding:usage:view` | `CodingUsagePayload`（和钟无关的全历史聚合） |
 * | `coding:usage:year` | `CodingUsageYearView`（最近 380 天，每天合计与模型前五） |
 * | `coding:activity:<来源>` | `StoredCodingActivity` |
 * | `coding:now:pushed` | 上一次 `coding-now` 推出去的 agents（`CodingNowPayload["agents"]`），推送门槛拿它比 |
 * | `coding:otlp` | `StoredOtlpCounters`（云端 OTLP 累计值做差用的计数器） |
 * | `pulse:token-buckets:<来源>` | `StoredCodingBuckets`（shared/coding-buckets），TTL 2 天 |
 * | `pulse:token-buckets:revision` | 桶修订号：哪一次提交改了桶就加一，那一份桶记下这个值 |
 */

export const codingUsageKey = (source: CodingUsageSource) => key("coding", "usage", source);
export const codingViewKey = () => key("coding", "usage", "view");
export const codingYearKey = () => key("coding", "usage", "year");
export const codingActivityKey = (source: CodingUsageSource) => key("coding", "activity", source);
export const codingPushedNowKey = () => key("coding", "now", "pushed");
export const codingOtlpKey = () => key("coding", "otlp");
export const codingBucketsKey = (source: CodingUsageSource) => key("pulse", "token-buckets", source);
/**
 * 修订号：严格递增，和它改到的账本或桶在同一个事务里写。D1 归档的水位用它不用时刻 —— 时刻只能取
 * 「和存着的较大者」，入口顺序与提交顺序相反时会等于水位，按 `> 水位` 挑增量就漏了。
 */
export const codingUsageRevisionKey = () => key("coding", "usage", "revision");
export const codingBucketsRevisionKey = () => key("pulse", "token-buckets", "revision");

/** 读回的修订号；没有（从没写过）或坏了是 0 */
export function parseRevision(raw: unknown): number {
  const value = typeof raw === "string" ? Number(raw) : Number.NaN;
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

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

/** 读回来的推送基准；没有（从没推过）或坏了都当空：下一封照推 */
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
