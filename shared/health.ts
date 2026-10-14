import type { HistoryDb } from "@shared/history-ingest";
import { loadLag, type LagResult } from "@shared/lag-result";
import { LAG_KEYS } from "@shared/lag";
import type { HealthBlock, HealthPayload, HealthSeries, UptimeDay } from "@shared/health-types";

export const CRON_HEARTBEAT_EVERY_MINUTES = 5;
// 须等于 workers/core/src/pulse-score.ts#PULSE_SCORE_SETTLE_MS 的分钟数（workers/core/src/cron-heartbeat.test.ts 核对）。
export const CRON_HEARTBEAT_OFFSET_MINUTES = 2;

export const SITE_UPTIME_URL = "https://lyjw.me/api/version";
export const UPTIME_PROBE_EVERY_MINUTES = 1;

export const HEALTH_DAYS = 30;
export const HEALTH_BUCKET_MS = 3_600_000;
const DAY_MS = 24 * HEALTH_BUCKET_MS;
// 多留两天，按 UTC 日切的最早一格总是完整的。
export const HEALTH_RETENTION_MS = (HEALTH_DAYS + 2) * DAY_MS;

export type HealthSeriesSpec = {
  name: string;
  everyMinutes: number;
  offsetMinutes: number;
  // 一轮从排定时刻到记下结果允许的最长延迟；过了还没记就算这一格没跑。
  graceMs: number;
  // 心跳没跑本身就是故障；探测没跑是探测器的问题，只记进 missed。
  missedIsFailure: boolean;
};

export const HEARTBEAT_SERIES: HealthSeriesSpec = {
  name: "core-cron",
  everyMinutes: CRON_HEARTBEAT_EVERY_MINUTES,
  offsetMinutes: CRON_HEARTBEAT_OFFSET_MINUTES,
  graceMs: 10 * 60_000,
  missedIsFailure: true,
};

export const UPTIME_SERIES: HealthSeriesSpec = {
  name: "site-uptime",
  everyMinutes: UPTIME_PROBE_EVERY_MINUTES,
  offsetMinutes: 0,
  graceMs: 3 * 60_000,
  missedIsFailure: false,
};

export type HealthBucket = {
  hourStart: number;
  success: number;
  failure: number;
  lastAt: number;
  lastOk: boolean;
};

const RECORD_CHECK = `INSERT INTO health_buckets(series, hour_start, success, failure, last_at, last_ok)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(series, hour_start) DO UPDATE SET
    success = health_buckets.success + excluded.success,
    failure = health_buckets.failure + excluded.failure,
    last_at = MAX(health_buckets.last_at, excluded.last_at),
    last_ok = CASE WHEN excluded.last_at >= health_buckets.last_at THEN excluded.last_ok ELSE health_buckets.last_ok END`;

// at 取排定时刻而不是记录时刻，跑得慢的一轮也落进它该在的那一格。
export async function recordCheck(db: HistoryDb, series: HealthSeriesSpec, at: number, ok: boolean): Promise<void> {
  const hourStart = Math.floor(at / HEALTH_BUCKET_MS) * HEALTH_BUCKET_MS;
  await db.batch([db.prepare(RECORD_CHECK).bind(series.name, hourStart, ok ? 1 : 0, ok ? 0 : 1, at, ok ? 1 : 0)]);
}

export async function pruneChecks(db: HistoryDb, now: number): Promise<void> {
  await db.batch([db.prepare("DELETE FROM health_buckets WHERE hour_start < ?").bind(now - HEALTH_RETENTION_MS)]);
}

type BucketRow = { hour_start: number; success: number; failure: number; last_at: number; last_ok: number };

export interface HealthReadDb {
  prepare(sql: string): { bind(...values: unknown[]): { all<T>(): Promise<{ results: T[] }> } };
}

export async function readBuckets(db: HealthReadDb, series: HealthSeriesSpec, now: number): Promise<HealthBucket[]> {
  const today = Math.floor(now / DAY_MS) * DAY_MS;
  const { results } = await db.prepare(
    "SELECT hour_start, success, failure, last_at, last_ok FROM health_buckets WHERE series = ? AND hour_start >= ? ORDER BY hour_start",
  ).bind(series.name, today - (HEALTH_DAYS - 1) * DAY_MS).all<BucketRow>();
  return results.map((row) => ({
    hourStart: row.hour_start,
    success: row.success,
    failure: row.failure,
    lastAt: row.last_at,
    lastOk: row.last_ok === 1,
  }));
}

export function expectedRuns(series: HealthSeriesSpec, hourStart: number, now: number): number {
  let count = 0;
  for (let minute = 0; minute < 60; minute++) {
    if ((minute - series.offsetMinutes) % series.everyMinutes !== 0) continue;
    if (hourStart + minute * 60_000 + series.graceMs <= now) count++;
  }
  return count;
}

export function availability(days: Pick<UptimeDay, "success" | "failure">[]): number | null {
  const success = days.reduce((sum, day) => sum + day.success, 0);
  const failure = days.reduce((sum, day) => sum + day.failure, 0);
  return success + failure > 0 ? success / (success + failure) : null;
}

type Tally = { success: number; failure: number; missed: number };

function tally(series: HealthSeriesSpec, bucket: HealthBucket | undefined, hourStart: number, now: number): Tally {
  const success = bucket?.success ?? 0;
  const failure = bucket?.failure ?? 0;
  const missed = Math.max(0, expectedRuns(series, hourStart, now) - success - failure);
  return series.missedIsFailure ? { success, failure: failure + missed, missed: 0 } : { success, failure, missed };
}

function status(series: HealthSeriesSpec, latest: HealthBucket | undefined, now: number): HealthSeries["status"] {
  if (!latest) return "unknown";
  const overdue = now - latest.lastAt > series.everyMinutes * 60_000 + series.graceMs;
  if (overdue) return series.missedIsFailure ? "down" : "unknown";
  return latest.lastOk ? "up" : "down";
}

// 第一格数据之前没有检查可数，那些天按 No data 显示，不把上线前算成漏跑。
export function summarizeBuckets(series: HealthSeriesSpec, buckets: readonly HealthBucket[], now: number): HealthSeries {
  const today = Math.floor(now / DAY_MS) * DAY_MS;
  const firstDay = today - (HEALTH_DAYS - 1) * DAY_MS;
  const byHour = new Map(buckets.map((bucket) => [bucket.hourStart, bucket]));
  const first = buckets.length ? Math.min(...buckets.map((bucket) => bucket.hourStart)) : Infinity;
  const currentHour = Math.floor(now / HEALTH_BUCKET_MS) * HEALTH_BUCKET_MS;
  const days: UptimeDay[] = [];
  const recent: Tally[] = [];
  for (let dayStart = firstDay; dayStart <= today; dayStart += DAY_MS) {
    const day: UptimeDay = { dayStart, success: 0, failure: 0, missed: 0 };
    for (let hourStart = dayStart; hourStart < dayStart + DAY_MS && hourStart <= currentHour; hourStart += HEALTH_BUCKET_MS) {
      if (hourStart < first) continue;
      const counts = tally(series, byHour.get(hourStart), hourStart, now);
      day.success += counts.success;
      day.failure += counts.failure;
      day.missed += counts.missed;
      if (hourStart > currentHour - DAY_MS) recent.push(counts);
    }
    days.push(day);
  }
  const latest = buckets.reduce<HealthBucket | undefined>((best, bucket) => (!best || bucket.lastAt > best.lastAt ? bucket : best), undefined);
  return {
    status: status(series, latest, now),
    availability24h: availability(recent),
    availability30d: availability(days),
    days,
  };
}

export const HEALTH_BLOCK_CARRY_MS = 24 * 3_600_000;

export function mergeHealth(next: HealthPayload, previous: HealthPayload | null): HealthPayload {
  const blockAt: Partial<Record<HealthBlock, number>> = {};
  const carry = <K extends HealthBlock>(block: K): HealthPayload[K] => {
    if (next[block] != null) {
      blockAt[block] = next.fetchedAt;
      return next[block];
    }
    const at = previous?.blockAt?.[block] ?? previous?.fetchedAt;
    if (previous?.[block] == null || at == null || next.fetchedAt - at >= HEALTH_BLOCK_CARRY_MS) return null as HealthPayload[K];
    blockAt[block] = at;
    return previous[block];
  };
  return {
    fetchedAt: next.fetchedAt,
    uptime: carry("uptime"),
    heartbeat: carry("heartbeat"),
    errors: carry("errors"),
    vitals: carry("vitals"),
    blockAt,
  };
}

export function getHealth(): Promise<LagResult<HealthPayload>> {
  return loadLag<HealthPayload>(LAG_KEYS.health, "Waiting for the first health check");
}
