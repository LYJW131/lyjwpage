import { limitHourRows, limitStatements, siteDay, type HistoryDb, type HistoryStatement, type LimitHourRow } from "@shared/history-ingest";
import {
  LIMIT_HISTORY_DAYS,
  LIMIT_HISTORY_HOURLY_DAYS,
  LIMIT_HISTORY_SERIES,
  limitHistoryFromRows,
  type LimitHistoryPayload,
  type LimitHistoryRow,
} from "@shared/limit-history";
import type { ParsedAgentLimits } from "@shared/agent-limits-parse";
import { getStorage, key, type StorageBatch } from "@shared/storage";
import { STORAGE_MAX_COMMANDS } from "@shared/storage-contract";

const DAY_MS = 86_400_000;
// 多留两天：归档失败几轮后补写、跨站点日边界读满 LIMIT_HISTORY_DAYS 天都还在。
export const LIMIT_HOURS_TTL_MS = (LIMIT_HISTORY_DAYS + 2) * DAY_MS;
const backfillMarkerKey = () => key("limits", "hours", "backfilled");
// 收到过的序列，归档按它列出要读的键；端点只读 LIMIT_HISTORY_SERIES 那几条，不读全部。
export const limitSeriesKey = () => key("limits", "series");

const seriesOf = (row: Pick<LimitHourRow, "agent" | "key">) => `${row.agent}|${row.key}`;

function limitHoursKey(series: string, date: string): string {
  return key("limits", "hours", series, date);
}

export function limitHoursKeys(series: readonly string[], from: number, to: number): string[] {
  const dates = new Set<string>();
  for (let at = from; at < to + DAY_MS; at += DAY_MS) dates.add(siteDay(Math.min(at, to)));
  return series.flatMap((id) => [...dates].map((date) => limitHoursKey(id, date)));
}

// StateHub 一次 execute 至多 STORAGE_MAX_COMMANDS 条命令，序列 × 天数会超过，要分批。
export function commandSlices<T>(items: readonly T[], size = STORAGE_MAX_COMMANDS): T[][] {
  const slices: T[][] = [];
  for (let at = 0; at < items.length; at += size) slices.push(items.slice(at, at + size));
  return slices;
}

function groupRows(rows: readonly StoredLimitHour[]) {
  const days = new Map<string, Record<string, string>>();
  const series: Record<string, string> = {};
  for (const row of rows) {
    const day = limitHoursKey(seriesOf(row), siteDay(row.hourAt));
    days.set(day, { ...days.get(day), [row.hourAt]: JSON.stringify(row) });
    series[seriesOf(row)] = "1";
  }
  return { days: [...days], series };
}

async function readHours(keys: readonly string[]): Promise<StoredLimitHour[]> {
  const hashes = await Promise.all(commandSlices(keys).map((slice) => {
    const batch = getStorage().batch();
    for (const day of slice) batch.fields(day);
    return batch.execute();
  }));
  return parseLimitHours(hashes.flat() as Record<string, string>[]);
}

// 同一整点按字段覆盖，留下的就是这一小时最后一次读数；提交在 StateHub 里串行，后到的读数不会比先到的旧。
export function stageLimitHours(batch: StorageBatch, limits: ParsedAgentLimits, receivedAt: number): boolean {
  const rows = limitHourRows(limits, receivedAt);
  if (!rows.length) return false;
  const { days, series } = groupRows(rows);
  for (const [day, fields] of days) batch.patch(day, fields).expire(day, LIMIT_HOURS_TTL_MS);
  batch.patch(limitSeriesKey(), series);
  return true;
}

type StoredLimitHour = LimitHourRow & { backfilled?: true };

function parseRow(raw: string): StoredLimitHour | null {
  try {
    const row = JSON.parse(raw) as StoredLimitHour;
    return typeof row.agent === "string" && typeof row.key === "string" && Number.isSafeInteger(row.hourAt) &&
      typeof row.usedPercent === "number" && Number.isSafeInteger(row.receivedAt) ? row : null;
  } catch {
    return null;
  }
}

export function parseLimitHours(hashes: readonly (Record<string, string> | null | undefined)[]): StoredLimitHour[] {
  return hashes.flatMap((hash) => Object.values(hash ?? {}).flatMap((raw) => parseRow(raw) ?? []));
}

function historyRow(row: LimitHourRow): LimitHistoryRow {
  return {
    agent: row.agent,
    limit_key: row.key,
    window_minutes: row.windowMinutes,
    used_percent: row.usedPercent,
    resets_at: row.resetsAt,
    received_at: row.receivedAt,
  };
}

// 最近 LIMIT_HISTORY_HOURLY_DAYS 天每小时一点，更早的每个站点日只留当天最晚那一点，和 D1 两张表的口径一致。
export function limitHistoryFromHours(rows: readonly LimitHourRow[], now: number): LimitHistoryPayload {
  const wanted = new Set(LIMIT_HISTORY_SERIES.map(seriesOf));
  const series = rows.filter((row) => wanted.has(seriesOf(row)));
  const hourlyFrom = now - LIMIT_HISTORY_HOURLY_DAYS * DAY_MS;
  const dailyFrom = siteDay(now - (LIMIT_HISTORY_DAYS - 1) * DAY_MS);
  const daily = new Map<string, LimitHourRow>();
  for (const row of series) {
    const date = siteDay(row.receivedAt);
    if (date < dailyFrom) continue;
    const id = `${seriesOf(row)}|${date}`;
    const kept = daily.get(id);
    if (!kept || row.receivedAt > kept.receivedAt) daily.set(id, row);
  }
  return limitHistoryFromRows(
    [...daily.values()].map(historyRow),
    series.filter((row) => row.hourAt >= hourlyFrom).map(historyRow),
  );
}

export async function getLimitHistory(now = Date.now()): Promise<LimitHistoryPayload> {
  const keys = limitHoursKeys(LIMIT_HISTORY_SERIES.map(seriesOf), now - LIMIT_HISTORY_DAYS * DAY_MS, now);
  return limitHistoryFromHours(await readHours(keys), now);
}

// 归档按收到时刻做水位；回填进来的行本来就在 D1 里，不再写回去。
export function limitArchiveStatements(db: HistoryDb, rows: readonly string[], watermark: number): { statements: HistoryStatement[]; watermark: number } {
  const fresh = rows.flatMap((raw) => parseRow(raw) ?? []).filter((row) => row.receivedAt > watermark);
  const live = fresh.filter((row) => !row.backfilled);
  return {
    statements: limitStatements(db, live),
    watermark: Math.max(watermark, ...fresh.map((row) => row.receivedAt)),
  };
}

const BACKFILL_HOURS = `SELECT agent, limit_key, hour_at, window_minutes, used_percent, resets_at, received_at
  FROM limit_hours WHERE hour_at >= ?`;
const BACKFILL_DAYS = `SELECT agent, limit_key, label, limit_group, window_minutes, used_percent, resets_at, plan, received_at
  FROM limit_snapshots WHERE date >= ?`;

type BackfillDb = { prepare(sql: string): { bind(...values: unknown[]): { all<T>(): Promise<{ results: T[] }> } } };
type BackfillRow = {
  agent: string; limit_key: string; hour_at?: number; label?: string | null; limit_group?: string | null;
  window_minutes: number | null; used_percent: number; resets_at: number | null; plan?: string | null; received_at: number;
};

// 只在第一次跑时把还在窗口内的 D1 行读回 StateHub，之后不再读 D1。
export async function backfillLimitHours(db: BackfillDb, now = Date.now()): Promise<number | null> {
  const storage = getStorage();
  if (await storage.get(backfillMarkerKey())) return null;
  const from = now - LIMIT_HISTORY_DAYS * DAY_MS;
  const [hours, snapshots] = await Promise.all([
    db.prepare(BACKFILL_HOURS).bind(from).all<BackfillRow>(),
    db.prepare(BACKFILL_DAYS).bind(siteDay(from)).all<BackfillRow>(),
  ]);
  const rows = new Map<string, StoredLimitHour>();
  for (const raw of [...snapshots.results, ...hours.results]) {
    const row: StoredLimitHour = {
      agent: raw.agent,
      key: raw.limit_key,
      hourAt: raw.hour_at ?? Math.floor(raw.received_at / 3_600_000) * 3_600_000,
      label: raw.label ?? null,
      group: raw.limit_group ?? null,
      windowMinutes: raw.window_minutes,
      usedPercent: raw.used_percent,
      resetsAt: raw.resets_at,
      plan: raw.plan ?? null,
      receivedAt: raw.received_at,
      backfilled: true,
    };
    if (row.hourAt >= from) rows.set(`${seriesOf(row)}|${row.hourAt}`, row);
  }
  const keys = limitHoursKeys([...new Set([...rows.values()].map(seriesOf))], from, now);
  for (const stored of await readHours(keys)) rows.delete(`${seriesOf(stored)}|${stored.hourAt}`);
  const { days, series } = groupRows([...rows.values()]);
  // 每个键一条 patch 一条 expire；中途失败时标记还没写，下一轮重来，已写的行按上面跳过。
  for (const slice of commandSlices(days, STORAGE_MAX_COMMANDS / 2)) {
    const write = storage.batch();
    for (const [day, fields] of slice) write.patch(day, fields).expire(day, LIMIT_HOURS_TTL_MS);
    await write.execute();
  }
  await storage.batch().patch(limitSeriesKey(), series).set(backfillMarkerKey(), String(now)).execute();
  return rows.size;
}
