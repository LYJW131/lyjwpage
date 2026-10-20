import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { bucketStart, type CodingActivityReport, type CodingTokenBucketReport, type CodingUsageAgent, type CodingUsageDay } from "./coding-usage.js";
import { config } from "./config.js";
import { aggregateEvents, CURSOR_AGENT_ID, cursorActivityReport, cursorBucketReport, emptyDay, latestOf, shanghaiDay, type CursorUsageDay } from "./cursor-aggregate.js";
import { fetchCursorHistory, sessionFromAccessToken } from "./cursor-history.js";
import { modelName, refreshOnlinePrices } from "./cursor-pricing.js";
import { readCursorAccessToken } from "./providers/cursor.js";

export { aggregateBuckets, aggregateEvents, CURSOR_AGENT_ID, cursorActivityReport, cursorBucketReport, latestOf, shanghaiDay, type CursorUsageDay, type LatestEvent } from "./cursor-aggregate.js";
export { CursorUsageError, fetchCursorHistory, fetchRecentRows, parseRecentPage, parseUsagePage, postPage, reconcilePages, sessionFromAccessToken, type RecentRow, type UsageEvent } from "./cursor-history.js";

const BUCKET_SPAN_MS = 24 * 3_600_000;

type Ledger = {
  version: 1;
  accountHash: string;
  collectedAt: string;
  days: Record<string, CursorUsageDay>;
  fullAt?: string;
  fullProblems?: string[];
};

const FULL_REFRESH_MS = 6 * 3_600_000;

function ledgerPath(): string {
  return path.join(config.home || "/data", "cursor-usage.json");
}

async function readLedger(): Promise<Ledger | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(ledgerPath(), "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    const row = parsed as Partial<Ledger>;
    if (row.version !== 1 || typeof row.accountHash !== "string" || !row.days || typeof row.days !== "object") return null;
    return {
      version: 1,
      accountHash: row.accountHash,
      collectedAt: typeof row.collectedAt === "string" ? row.collectedAt : "",
      days: row.days,
      ...(typeof row.fullAt === "string" ? { fullAt: row.fullAt } : {}),
      ...(Array.isArray(row.fullProblems) && row.fullProblems.every((item) => typeof item === "string")
        ? { fullProblems: row.fullProblems }
        : {}),
    };
  } catch {
    return null;
  }
}

async function writeLedger(ledger: Ledger): Promise<void> {
  const file = ledgerPath();
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(ledger), { mode: 0o600 });
  await rename(temporary, file);
}

// 云端历史窗口可能缩短；缺席的旧日不能从本地账本删除。
export function applyLedger(
  previous: Ledger | null,
  accountHash: string,
  incoming: CursorUsageDay[],
  collectedAt: string,
  unmeasured: number,
): { ledger: Ledger; usage: CodingUsageAgent } {
  const fresh = previous?.accountHash === accountHash ? { ...previous.days } : {};
  const problems: string[] = [];
  if (unmeasured > 0) problems.push(`${unmeasured} historical requests had no token counts`);
  const incomingDates = new Set(incoming.map((day) => day.date));
  const previousDates = Object.values(fresh)
    .filter((day) => day.totalTokens > 0)
    .map((day) => day.date)
    .sort();
  const incomingNonzero = incoming.filter((day) => day.totalTokens > 0).map((day) => day.date);
  const incomingStart = incomingNonzero[0] ?? null;
  const incomingEnd = incomingNonzero.at(-1) ?? null;
  if (previousDates[0] && (!incomingStart || incomingStart > previousDates[0])) {
    problems.push("History start moved forward; kept older days");
  }
  if (previousDates.at(-1) && (!incomingEnd || incomingEnd < previousDates.at(-1)!)) {
    problems.push("History end moved backward; kept newer days");
  }
  const missing = previousDates.filter((date) => !incomingDates.has(date));
  if (missing.length > 0) problems.push(`Kept ${missing.length} active days the cloud no longer returns`);
  for (const day of incoming) fresh[day.date] = day;
  const ledger: Ledger = {
    version: 1,
    accountHash,
    collectedAt,
    days: fresh,
    fullAt: collectedAt,
    fullProblems: problems,
  };
  return { ledger, usage: usageFrom(ledger, problems) };
}

export function applyIncrementalLedger(
  previous: Ledger,
  incoming: CursorUsageDay[],
  collectedAt: string,
): { ledger: Ledger; usage: CodingUsageAgent } {
  const days = { ...previous.days };
  for (const day of incoming) days[day.date] = day;
  const ledger: Ledger = { ...previous, collectedAt, days };
  return { ledger, usage: usageFrom(ledger, previous.fullProblems ?? []) };
}

function wireDay(day: CursorUsageDay): CodingUsageDay {
  return {
    date: day.date,
    inputTokens: day.inputTokens,
    outputTokens: day.outputTokens,
    cacheReadTokens: day.cacheReadTokens,
    cacheCreationTokens: day.cacheCreationTokens,
    reasoningTokens: 0,
    totalTokens: day.totalTokens,
    apiEquivalentCostUSD: day.apiEquivalentCostUSD,
    costComplete: day.costComplete,
    models: day.models,
  };
}

function usageFrom(ledger: Ledger, problems: string[]): CodingUsageAgent {
  return {
    id: CURSOR_AGENT_ID,
    state: "ok",
    collectedAt: Date.parse(ledger.collectedAt),
    error: null,
    warning: problems.length > 0 ? problems.join("; ") : null,
    sessionCount: null,
    days: Object.values(ledger.days)
      .sort((left, right) => (left.date < right.date ? -1 : 1))
      .map(wireDay),
  };
}

export function failedUsage(error: unknown, lastCollectedAt: string | null): CodingUsageAgent {
  const at = lastCollectedAt ? Date.parse(lastCollectedAt) : Number.NaN;
  return {
    id: CURSOR_AGENT_ID,
    state: "error",
    collectedAt: Number.isFinite(at) ? at : null,
    error: error instanceof Error ? error.message : String(error),
    warning: null,
    sessionCount: null,
  };
}

export async function cursorUsageFailure(error: unknown): Promise<CodingUsageAgent> {
  return failedUsage(error, (await readLedger())?.collectedAt ?? null);
}

export function incrementalSince(now: number): number {
  return Date.parse(`${shanghaiDay(now - 86_400_000)}T00:00:00+08:00`);
}

function needsFullRefresh(ledger: Ledger | null, accountHash: string, now: number): boolean {
  if (!ledger || ledger.accountHash !== accountHash || !ledger.fullAt) return true;
  const fullAt = Date.parse(ledger.fullAt);
  return !Number.isFinite(fullAt) || now - fullAt >= FULL_REFRESH_MS || now < fullAt;
}

export type CursorCollected = {
  usage: CodingUsageAgent;
  activity: CodingActivityReport;
  buckets: CodingTokenBucketReport;
  latestAt: number | null;
};

export async function collectCursorUsage(now = Date.now()): Promise<CursorCollected | null> {
  if (config.limitsFixture) return null;
  const accessToken = await readCursorAccessToken();
  if (!accessToken) return null;
  const session = sessionFromAccessToken(accessToken);
  const previous = await readLedger();
  const full = needsFullRefresh(previous, session.accountHash, now);
  const since = full ? 0 : incrementalSince(now);
  const [events] = await Promise.all([
    fetchCursorHistory(session.cookie, now, undefined, since),
    refreshOnlinePrices(now),
  ]);
  const aggregated = aggregateEvents(events, now);
  const collectedAt = new Date(now).toISOString();
  let applied: { ledger: Ledger; usage: CodingUsageAgent };
  if (full || !previous) {
    applied = applyLedger(previous, session.accountHash, aggregated.days, collectedAt, aggregated.unmeasured);
  } else {
    const yesterday = shanghaiDay(now - 86_400_000);
    const days = aggregated.days.some((day) => day.date === yesterday)
      ? aggregated.days
      : [emptyDay(yesterday), ...aggregated.days];
    applied = applyIncrementalLedger(previous, days, collectedAt);
  }
  await writeLedger(applied.ledger);
  const latest = latestOf(events.map((event) => ({ at: event.timestampMs, model: modelName(event.model) })));
  const from = Math.max(since, bucketStart(now - BUCKET_SPAN_MS));
  return {
    usage: applied.usage,
    activity: cursorActivityReport(now, latest),
    buckets: cursorBucketReport(events, { from, to: now }, now),
    latestAt: latest?.at ?? null,
  };
}
