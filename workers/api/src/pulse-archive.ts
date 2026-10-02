import { codingObservationsKey, cursorObservationsKey } from "@/lib/coding-pulse";
import {
  pulseActivityKey,
  pulseActivityRangeKey,
  pulseActivityRevisionKey,
  pulseChargingKey,
  pulseLaneKey,
  pulseListeningTracesKey,
} from "@/lib/pulse-keys";
import { coveringPart, parseStoredCodingBuckets, type StoredCodingBuckets } from "@shared/coding-buckets";
import { codingBucketsKey, codingUsageKey, codingUsageRevisionKey, parseRevision } from "@shared/coding-store";
import { CODING_USAGE_SOURCE_NAMES, isCodingUsageSource, type CodingUsageSource } from "@shared/coding-usage-sources";
import type { StoredCodingUsageAgent } from "@shared/coding-usage-view";
import type { HistoryDb, HistoryStatement } from "@shared/history-ingest";
import { parseCodingObservation, CODING_OBSERVATION_HOLD_MS, type CodingObservation } from "@shared/pulse-coding";
import { cursorWindowFeatures, parseCursorObservation } from "@shared/pulse-cursor";
import { parseListeningTrace } from "@shared/pulse-listening";
import {
  chargingSessions,
  parseActivityBucket,
  parseChargingSample,
  parseClosedInterval,
  type ActivityBucket,
  type ClosedInterval,
  type StateLaneFacts,
} from "@shared/pulse-timeline";
import { CHARGING_IDLE_MAX_W } from "@/lib/home-layout";
import type { StorageCommand } from "@shared/storage-contract";


type SqlValue = string | number | null;
export interface ArchiveSql {
  exec(query: string, ...bindings: SqlValue[]): { toArray(): Record<string, unknown>[] };
}

export type PulseArchiveDb = HistoryDb;

export const ARCHIVE_STREAMS = [
  "listening",
  "listening-traces",
  "watching",
  "gaming",
  "charging",
  "activity",
  "coding",
  "coding-usage",
  "coding-buckets",
] as const;
export type ArchiveStream = (typeof ARCHIVE_STREAMS)[number];

export type PulseArchiveStreamSnapshot = {
  stream: ArchiveStream;
  revision: number;
  watermark: number;
  rows: string[];
  extra?: string[];
  value?: string | null;
  coding?: Partial<Record<CodingUsageSource, string[]>>;
  replaceRange?: { from: number; to: number };
  replaceToken?: string;
  error?: string;
};

export type PulseArchiveSnapshot = { now: number; streams: PulseArchiveStreamSnapshot[] };

export interface PulseArchiveCoordinator {
  confirmPulseArchive(stream: ArchiveStream, at: number, replaceToken?: string): Promise<number>;
}

const WATERMARK_PREFIX = "pulse-archive:v2:";
const REVISION_KEY = "pulse-archive:revision";
const ACTIVITY_REPLACED_KEY = "pulse-archive:v2:activity-replaced";
const DAY_MS = 24 * 60 * 60 * 1000;
const SITE_OFFSET_MS = 8 * 60 * 60 * 1000;
const SESSION_CONTEXT_MS = 2 * DAY_MS;
const CHUNK_SIZE = 100;

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function siteDayStart(at: number): number {
  return Math.floor((at + SITE_OFFSET_MS) / DAY_MS) * DAY_MS - SITE_OFFSET_MS;
}
export function siteDate(at: number): string {
  return new Date(siteDayStart(at) + SITE_OFFSET_MS).toISOString().slice(0, 10);
}

export class PulseArchiveState implements PulseArchiveCoordinator {
  private sql: ArchiveSql;
  private execute: (commands: StorageCommand[]) => unknown[];
  private now: () => number;

  constructor(options: {
    sql: ArchiveSql;
    execute: (commands: StorageCommand[]) => unknown[];
    now?: () => number;
  }) {
    this.sql = options.sql;
    this.execute = options.execute;
    this.now = options.now ?? Date.now;
  }

  async readPulseArchive(): Promise<PulseArchiveSnapshot> {
    const revision = this.nextRevision();
    const now = this.now();
    const streams: PulseArchiveStreamSnapshot[] = [];
    for (const stream of ARCHIVE_STREAMS) {
      const watermark = this.watermark(stream);
      try {
        streams.push({ stream, revision, watermark, ...this.readStream(stream, watermark) });
      } catch (error) {
        streams.push({ stream, revision, watermark, rows: [], error: reason(error) });
      }
    }
    return { now, streams };
  }

  private readStream(stream: ArchiveStream, watermark: number): Omit<PulseArchiveStreamSnapshot, "stream" | "revision" | "watermark"> {
    switch (stream) {
      case "listening":
        return { rows: this.readSince(pulseLaneKey(stream), watermark, "to") };
      case "gaming": case "watching":
        return { rows: this.readSince(pulseLaneKey(stream), watermark - SESSION_CONTEXT_MS, "to",
          (row) => (stream === "gaming" ? row.state === "in-game" : row.state !== "idle")) };
      case "listening-traces":
        return { rows: this.readSince(pulseListeningTracesKey(), watermark, "t") };
      case "charging":
        return { rows: this.readSince(pulseChargingKey(), watermark - SESSION_CONTEXT_MS, "t",
          (row) => typeof row.watts === "number" && row.watts > CHARGING_IDLE_MAX_W) };
      case "coding": {
        const since = siteDayStart(watermark);
        return { rows: this.readSince(codingObservationsKey(), since, "t"), extra: this.readSince(cursorObservationsKey(), since - CODING_OBSERVATION_HOLD_MS, "t") };
      }
      case "activity": {
        const [rows, range, revision] = this.execute([
          { op: "listRange", key: pulseActivityKey(), start: 0, stop: -1 },
          { op: "get", key: pulseActivityRangeKey() },
          { op: "get", key: pulseActivityRevisionKey() },
        ]) as [string[], string | null, string | null];
        const parsed = typeof range === "string" ? JSON.parse(range) as { from?: unknown; to?: unknown } : null;
        const replaceRange = parsed && Number.isSafeInteger(parsed.from) && Number.isSafeInteger(parsed.to) && (parsed.from as number) < (parsed.to as number)
          ? { from: parsed.from as number, to: parsed.to as number }
          : undefined;
        const replaceToken = replaceRange ? JSON.stringify([revision ?? null, replaceRange.from, replaceRange.to]) : undefined;
        const pending = replaceToken !== undefined && replaceToken !== this.metadata(ACTIVITY_REPLACED_KEY);
        return pending ? { rows, replaceRange, replaceToken } : { rows: [] };
      }
      case "coding-usage": {
        const [rawRevision] = this.execute([{ op: "get", key: codingUsageRevisionKey() }]) as [string | null];
        if (parseRevision(rawRevision) <= watermark) return { rows: [] };
        const hashes = this.execute(CODING_USAGE_SOURCE_NAMES.map((source): StorageCommand => ({ op: "fields", key: codingUsageKey(source) }))) as Record<string, string>[];
        const coding: Partial<Record<CodingUsageSource, string[]>> = {};
        CODING_USAGE_SOURCE_NAMES.forEach((source, index) => {
          const changed = Object.values(hashes[index] ?? {}).filter((raw) => revisionOf(parsedJson<{ revision?: unknown }>(raw)) > watermark);
          if (changed.length) coding[source] = changed;
        });
        return { rows: [], coding };
      }
      case "coding-buckets": {
        const values = this.execute(CODING_USAGE_SOURCE_NAMES.map((source): StorageCommand => ({ op: "get", key: codingBucketsKey(source) }))) as (string | null)[];
        const coding: Partial<Record<CodingUsageSource, string[]>> = {};
        CODING_USAGE_SOURCE_NAMES.forEach((source, index) => {
          const raw = values[index];
          const stored = parseStoredCodingBuckets(raw);
          if (raw && stored && revisionOf(stored) > watermark) coding[source] = [raw];
        });
        return { rows: [], coding };
      }
    }
  }

  // 回看边界若落在会话中，必须继续读到起点；否则每轮会插入起点漂移的重叠会话。
  private readSince(listKey: string, since: number, field: "t" | "to", inSession?: (row: Record<string, unknown>) => boolean): string[] {
    for (let size = 256; ; size *= 4) {
      const rows = this.execute([{ op: "listRange", key: listKey, start: -size, stop: -1 }])[0] as string[];
      if (rows.length < size) return rows;
      let first: Record<string, unknown>;
      try { first = JSON.parse(rows[0]) as Record<string, unknown>; } catch { return rows; }
      const at = first[field];
      if (typeof at === "number" && at > since) continue;
      if (!inSession?.(first)) return rows;
    }
  }

  async confirmPulseArchive(stream: ArchiveStream, at: number, replaceToken?: string): Promise<number> {
    if (!ARCHIVE_STREAMS.includes(stream) || !Number.isSafeInteger(at) || at < 0 ||
        (replaceToken !== undefined && (stream !== "activity" || typeof replaceToken !== "string"))) {
      throw new Error("Invalid Pulse archive confirmation");
    }
    if (replaceToken !== undefined) {
      this.sql.exec(
        `INSERT INTO metadata(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
        ACTIVITY_REPLACED_KEY,
        replaceToken,
      );
    }
    this.sql.exec(
      `INSERT INTO metadata(key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = CASE
         WHEN CAST(excluded.value AS INTEGER) > CAST(metadata.value AS INTEGER) THEN excluded.value
         ELSE metadata.value
       END`,
      WATERMARK_PREFIX + stream,
      String(at),
    );
    return this.watermark(stream);
  }

  private watermark(stream: ArchiveStream): number {
    const at = Number(this.metadata(WATERMARK_PREFIX + stream));
    return Number.isFinite(at) ? at : 0;
  }

  private metadata(name: string): string | null {
    const row = this.sql.exec("SELECT value FROM metadata WHERE key = ?", name).toArray()[0];
    return typeof row?.value === "string" ? row.value : null;
  }

  private nextRevision(): number {
    this.sql.exec(
      `INSERT INTO metadata(key, value) VALUES (?, '1')
       ON CONFLICT(key) DO UPDATE SET value = CAST(metadata.value AS INTEGER) + 1`,
      REVISION_KEY,
    );
    const row = this.sql.exec("SELECT value FROM metadata WHERE key = ?", REVISION_KEY).toArray()[0];
    return Number(row?.value) || 1;
  }
}


const INSERT_LISTENING_PLAY = `INSERT OR IGNORE INTO listening_plays(source, started_at, ended_at, certain, title, artist, album, track_id, item_id)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const UPSERT_WATCHING_SESSION = `INSERT INTO watching_sessions(item_id, started_at, ended_at, playing_seconds, title, subtitle)
  VALUES (?, ?, ?, ?, ?, ?)
  ON CONFLICT(item_id, started_at) DO UPDATE SET ended_at = excluded.ended_at, playing_seconds = excluded.playing_seconds,
    title = excluded.title, subtitle = excluded.subtitle
  WHERE watching_sessions.ended_at IS NOT excluded.ended_at OR watching_sessions.playing_seconds IS NOT excluded.playing_seconds
    OR watching_sessions.title IS NOT excluded.title OR watching_sessions.subtitle IS NOT excluded.subtitle`;
const UPSERT_GAME_SESSION = `INSERT INTO game_sessions(title_id, started_at, ended_at, title)
  VALUES (?, ?, ?, ?)
  ON CONFLICT(title_id, started_at) DO UPDATE SET ended_at = excluded.ended_at, title = excluded.title
  WHERE game_sessions.ended_at IS NOT excluded.ended_at OR game_sessions.title IS NOT excluded.title`;
const INSERT_CHARGING_SAMPLE = "INSERT OR IGNORE INTO charging_samples(t, watts, device) VALUES (?, ?, ?)";
const UPSERT_CHARGING_SESSION = `INSERT INTO charging_sessions(started_at, ended_at, peak_w, energy_wh, device)
  VALUES (?, ?, ?, ?, ?)
  ON CONFLICT(started_at) DO UPDATE SET ended_at = excluded.ended_at, peak_w = excluded.peak_w,
    energy_wh = excluded.energy_wh, device = excluded.device
  WHERE charging_sessions.ended_at IS NOT excluded.ended_at OR charging_sessions.peak_w IS NOT excluded.peak_w
    OR charging_sessions.energy_wh IS NOT excluded.energy_wh OR charging_sessions.device IS NOT excluded.device`;
const CLAIM_ACTIVITY_REVISION = `INSERT INTO pulse_archive_state(domain, revision) VALUES ('activity_buckets', ?)
  ON CONFLICT(domain) DO UPDATE SET revision = MAX(revision, excluded.revision)`;
const DELETE_ACTIVITY_RANGE = `DELETE FROM activity_buckets WHERE started_at < ? AND ended_at > ?
  AND started_at NOT IN (SELECT json_extract(value, '$.from') FROM json_each(?))
  AND (SELECT revision FROM pulse_archive_state WHERE domain = 'activity_buckets') = ?`;
const REPLACE_ACTIVITY = `INSERT INTO activity_buckets(started_at, ended_at, steps, move_kcal, exercise_minutes)
  SELECT json_extract(value, '$.from'), json_extract(value, '$.to'), json_extract(value, '$.steps'),
    json_extract(value, '$.moveKcal'), json_extract(value, '$.exerciseMinutes') FROM json_each(?)
  WHERE (SELECT revision FROM pulse_archive_state WHERE domain = 'activity_buckets') = ?
  ON CONFLICT(started_at) DO UPDATE SET ended_at = excluded.ended_at, steps = excluded.steps,
    move_kcal = excluded.move_kcal, exercise_minutes = excluded.exercise_minutes
  WHERE activity_buckets.ended_at IS NOT excluded.ended_at OR activity_buckets.steps IS NOT excluded.steps
    OR activity_buckets.move_kcal IS NOT excluded.move_kcal OR activity_buckets.exercise_minutes IS NOT excluded.exercise_minutes`;
const INSERT_CODING_OBSERVATION = `INSERT OR IGNORE INTO coding_observations(t, available, application, coding, agents)
  VALUES (?, ?, ?, ?, ?)`;
const UPSERT_ACTIVE_SECONDS = `INSERT INTO coding_active_days(date, agent, model, active_seconds) VALUES (?, ?, ?, ?)
  ON CONFLICT(date, agent, model) DO UPDATE SET active_seconds = excluded.active_seconds
  WHERE excluded.active_seconds > coding_active_days.active_seconds`;
const UPSERT_USAGE_DAYS = `INSERT INTO coding_usage_days(date, source, agent, input_tokens, output_tokens, cache_read_tokens,
    cache_creation_tokens, reasoning_tokens, total_tokens, cost_usd, cost_complete, revision)
  SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]'), json_extract(value, '$[3]'),
    json_extract(value, '$[4]'), json_extract(value, '$[5]'), json_extract(value, '$[6]'), json_extract(value, '$[7]'),
    json_extract(value, '$[8]'), json_extract(value, '$[9]'), json_extract(value, '$[10]'), json_extract(value, '$[11]') FROM json_each(?) WHERE true
  ON CONFLICT(date, source, agent) DO UPDATE SET input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens,
    cache_read_tokens = excluded.cache_read_tokens, cache_creation_tokens = excluded.cache_creation_tokens,
    reasoning_tokens = excluded.reasoning_tokens, total_tokens = excluded.total_tokens, cost_usd = excluded.cost_usd,
    cost_complete = excluded.cost_complete, revision = excluded.revision
  WHERE excluded.revision > coding_usage_days.revision`;
const UPSERT_USAGE_MODELS = `INSERT INTO coding_usage_models(date, source, agent, model, tokens, revision)
  SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]'), json_extract(value, '$[3]'),
    json_extract(value, '$[4]'), json_extract(value, '$[5]') FROM json_each(?) WHERE true
  ON CONFLICT(date, source, agent, model) DO UPDATE SET tokens = excluded.tokens, revision = excluded.revision
  WHERE excluded.revision > coding_usage_models.revision`;
// 去重重扫可能使桶计数变小，不能用 max 代替新版本覆盖。
const UPSERT_USAGE_BUCKETS = `INSERT INTO coding_usage_buckets(bucket_at, source, agent, model, input_tokens, output_tokens, cache_read_tokens,
    cache_creation_tokens, reasoning_tokens, event_count, revision)
  SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]'), json_extract(value, '$[3]'),
    json_extract(value, '$[4]'), json_extract(value, '$[5]'), json_extract(value, '$[6]'), json_extract(value, '$[7]'),
    json_extract(value, '$[8]'), json_extract(value, '$[9]'), json_extract(value, '$[10]') FROM json_each(?) WHERE true
  ON CONFLICT(bucket_at, source, agent, model) DO UPDATE SET input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens,
    cache_read_tokens = excluded.cache_read_tokens, cache_creation_tokens = excluded.cache_creation_tokens,
    reasoning_tokens = excluded.reasoning_tokens, event_count = excluded.event_count, revision = excluded.revision
  WHERE excluded.revision > coding_usage_buckets.revision`;
const JSON_ROWS_PER_STATEMENT = 500;

type Statement = HistoryStatement;
type Built = { statements: Statement[]; watermark: number; replaceToken?: string };

function parsedRows<T>(rows: string[], parse: (raw: string) => T | null): T[] {
  return rows.flatMap((raw) => {
    const row = parse(raw);
    return row ? [row] : [];
  });
}

function sessions<F extends { state: string }>(
  rows: ClosedInterval<F>[],
  watermark: number,
  idOf: (row: F) => string | null,
  include: (row: F) => boolean,
): { id: string; rows: ClosedInterval<F>[] }[] {
  const groups: { id: string; rows: ClosedInterval<F>[] }[] = [];
  for (const row of [...rows].sort((a, b) => a.from - b.from)) {
    const id = idOf(row);
    if (!include(row) || id == null) continue;
    const last = groups.at(-1);
    const tail = last?.rows.at(-1);
    if (last && tail && last.id === id && tail.to === row.from) last.rows.push(row);
    else groups.push({ id, rows: [row] });
  }
  return groups.filter((group) => group.rows.some((row) => row.to > watermark));
}

export function activeSecondsByDay(observations: CodingObservation[], cursor: ReturnType<typeof parseCursorObservation>[], from: number, to: number) {
  const totals = new Map<string, number>();
  const add = (date: string, agent: string, model: string, ms: number) => {
    const k = JSON.stringify([date, agent, model]);
    totals.set(k, (totals.get(k) ?? 0) + ms);
  };
  const sorted = [...observations].sort((a, b) => a.t - b.t);
  for (let i = 0; i < sorted.length; i++) {
    const observation = sorted[i];
    if (!observation.available || !observation.agents) continue;
    const start = Math.max(from, observation.t);
    const end = Math.min(to, observation.t + CODING_OBSERVATION_HOLD_MS, sorted[i + 1]?.t ?? to);
    const active = observation.agents.filter((agent) => agent.active);
    if (end <= start || !active.length) continue;
    for (let cut = start; cut < end;) {
      const next = Math.min(end, siteDayStart(cut) + DAY_MS);
      const date = siteDate(cut);
      for (const agent of active) add(date, agent.id, agent.model ?? "", next - cut);
      for (const id of new Set(active.map((agent) => agent.id))) add(date, id, "*", next - cut);
      cut = next;
    }
  }
  const account = cursorWindowFeatures(cursor.filter((row) => row !== null).sort((a, b) => a.t - b.t), { from, to });
  for (const part of account.activeCoverage) {
    for (let cut = part.from; cut < part.to;) {
      const next = Math.min(part.to, siteDayStart(cut) + DAY_MS);
      add(siteDate(cut), "cursor", "*", next - cut);
      cut = next;
    }
  }
  return [...totals].map(([k, ms]) => {
    const [date, agent, model] = JSON.parse(k) as [string, string, string];
    return { date, agent, model, seconds: Math.round(ms / 1000) };
  });
}

function chunked(db: PulseArchiveDb, query: string, rows: unknown[][]): Statement[] {
  const statements: Statement[] = [];
  for (let at = 0; at < rows.length; at += JSON_ROWS_PER_STATEMENT) {
    statements.push(db.prepare(query).bind(JSON.stringify(rows.slice(at, at + JSON_ROWS_PER_STATEMENT))));
  }
  return statements;
}

function parsedJson<T>(raw: string): T | null {
  try { return JSON.parse(raw) as T; } catch { return null; }
}

function revisionOf(value: { revision?: unknown } | null): number {
  return value && Number.isSafeInteger(value.revision) ? value.revision as number : 0;
}

// 数值未变也必须推进每行修订号，防止重叠归档中的旧快照晚写而回退。
function usageStatements(db: PulseArchiveDb, coding: PulseArchiveStreamSnapshot["coding"]): { statements: Statement[]; revisions: number[] } {
  const days: unknown[][] = [];
  const models: unknown[][] = [];
  const revisions: number[] = [];
  for (const [source, raws] of Object.entries(coding ?? {})) {
    if (!isCodingUsageSource(source)) continue;
    for (const raw of raws ?? []) {
      const ledger = parsedJson<StoredCodingUsageAgent>(raw);
      if (!ledger || typeof ledger.id !== "string" || !Array.isArray(ledger.days)) continue;
      const revision = revisionOf(ledger);
      revisions.push(revision);
      for (const day of ledger.days) {
        days.push([day.date, source, ledger.id, day.inputTokens, day.outputTokens, day.cacheReadTokens, day.cacheCreationTokens,
          day.reasoningTokens, day.totalTokens, day.apiEquivalentCostUSD, day.costComplete ? 1 : 0, revision]);
        for (const row of day.models) models.push([day.date, source, ledger.id, row.model, row.tokens, revision]);
      }
    }
  }
  return { statements: [...chunked(db, UPSERT_USAGE_DAYS, days), ...chunked(db, UPSERT_USAGE_MODELS, models)], revisions };
}

// 跨报告起点的首桶可能只数了后半截，不能覆盖 D1 已有的完整桶。
function bucketStatements(db: PulseArchiveDb, coding: PulseArchiveStreamSnapshot["coding"]): { statements: Statement[]; revisions: number[] } {
  const rows: unknown[][] = [];
  const revisions: number[] = [];
  for (const [source, raws] of Object.entries(coding ?? {})) {
    if (!isCodingUsageSource(source)) continue;
    for (const raw of raws ?? []) {
      const stored: StoredCodingBuckets | null = parseStoredCodingBuckets(raw);
      if (!stored) continue;
      const revision = revisionOf(stored);
      revisions.push(revision);
      for (const window of stored.windows) {
        if (source !== "agents-otlp" && !coveringPart(stored.coverage, window.from)) continue;
        for (const agent of window.agents) {
          rows.push([window.from, source, agent.id, agent.model ?? "", agent.inputTokens, agent.outputTokens, agent.cacheReadTokens,
            agent.cacheCreationTokens, agent.reasoningTokens, agent.eventCount, revision]);
        }
      }
    }
  }
  return { statements: chunked(db, UPSERT_USAGE_BUCKETS, rows), revisions };
}

export function archiveStatements(db: PulseArchiveDb, snapshot: PulseArchiveStreamSnapshot, now: number): Built {
  const { watermark } = snapshot;
  switch (snapshot.stream) {
    case "listening": {
      const rows = parsedRows(snapshot.rows, (raw) => parseClosedInterval("listening", raw)).filter((row) => row.to > watermark);
      return {
        statements: rows.filter((row) => row.state === "playing").map((row) => db.prepare(INSERT_LISTENING_PLAY).bind(
          row.source ?? "unknown", row.from, row.to, 1, row.title, row.artist, row.album, row.trackId, null)),
        watermark: Math.max(watermark, ...rows.map((row) => row.to)),
      };
    }
    case "listening-traces": {
      const rows = parsedRows(snapshot.rows, parseListeningTrace).filter((row) => row.t > watermark);
      return {
        statements: rows.map((row) => db.prepare(INSERT_LISTENING_PLAY).bind("recent", row.since, row.t, 0, row.title, row.artist, row.album, null, row.itemId)),
        watermark: Math.max(watermark, ...rows.map((row) => row.t)),
      };
    }
    case "watching": {
      const rows = parsedRows(snapshot.rows, (raw) => parseClosedInterval("watching", raw));
      const groups = sessions<StateLaneFacts["watching"]>(rows, watermark, (row) => row.itemId, (row) => row.state !== "idle");
      return {
        statements: groups.map(({ id, rows: parts }) => {
          const named = parts.find((part) => part.title) ?? parts[0];
          const playing = parts.filter((part) => part.state === "playing").reduce((sum, part) => sum + part.to - part.from, 0);
          return db.prepare(UPSERT_WATCHING_SESSION).bind(id, parts[0].from, parts.at(-1)!.to, Math.round(playing / 1000), named.title, named.subtitle);
        }),
        watermark: Math.max(watermark, ...rows.map((row) => row.to)),
      };
    }
    case "gaming": {
      const rows = parsedRows(snapshot.rows, (raw) => parseClosedInterval("gaming", raw));
      const groups = sessions<StateLaneFacts["gaming"]>(rows, watermark, (row) => row.titleId ?? row.title, (row) => row.state === "in-game");
      return {
        statements: groups.map(({ id, rows: parts }) =>
          db.prepare(UPSERT_GAME_SESSION).bind(id, parts[0].from, parts.at(-1)!.to, (parts.find((part) => part.title) ?? parts[0]).title)),
        watermark: Math.max(watermark, ...rows.map((row) => row.to)),
      };
    }
    case "charging": {
      const samples = parsedRows(snapshot.rows, parseChargingSample).sort((a, b) => a.t - b.t);
      const fresh = samples.filter((sample) => sample.t > watermark);
      if (!fresh.length) return { statements: [], watermark };
      return {
        statements: [
          ...fresh.map((sample) => db.prepare(INSERT_CHARGING_SAMPLE).bind(sample.t, sample.watts, sample.device ?? null)),
          ...chargingSessions(samples, now).filter((session) => session.endedAt > watermark).map((session) =>
            db.prepare(UPSERT_CHARGING_SESSION).bind(session.startedAt, session.endedAt, session.peakW, session.energyWh, session.device)),
        ],
        watermark: fresh.at(-1)!.t,
      };
    }
    case "activity": {
      if (!snapshot.replaceRange || !snapshot.replaceToken) return { statements: [], watermark };
      const range = snapshot.replaceRange;
      const buckets = parsedRows(snapshot.rows, parseActivityBucket).filter((bucket: ActivityBucket) => bucket.from < range.to && bucket.to > range.from);
      const json = JSON.stringify(buckets);
      return {
        statements: [
          db.prepare(CLAIM_ACTIVITY_REVISION).bind(snapshot.revision),
          db.prepare(DELETE_ACTIVITY_RANGE).bind(range.to, range.from, json, snapshot.revision),
          db.prepare(REPLACE_ACTIVITY).bind(json, snapshot.revision),
        ],
        watermark: Math.max(watermark, ...buckets.map((bucket) => bucket.to)),
        replaceToken: snapshot.replaceToken,
      };
    }
    case "coding": {
      const observations = parsedRows(snapshot.rows, parseCodingObservation).sort((a, b) => a.t - b.t);
      const fresh = observations.filter((row) => row.t > watermark);
      if (!fresh.length) return { statements: [], watermark };
      const cursor = (snapshot.extra ?? []).map(parseCursorObservation);
      const active = activeSecondsByDay(observations, cursor, siteDayStart(watermark), now);
      return {
        statements: [
          ...fresh.map((row) => db.prepare(INSERT_CODING_OBSERVATION).bind(
            row.t, row.available ? 1 : 0, row.desktop?.application ?? null,
            row.desktop ? (row.desktop.coding ? 1 : 0) : null, row.agents ? JSON.stringify(row.agents) : null)),
          ...active.map((row) => db.prepare(UPSERT_ACTIVE_SECONDS).bind(row.date, row.agent, row.model, row.seconds)),
        ],
        watermark: fresh.at(-1)!.t,
      };
    }
    case "coding-usage": case "coding-buckets": {
      const built = snapshot.stream === "coding-usage" ? usageStatements(db, snapshot.coding) : bucketStatements(db, snapshot.coding);
      return { statements: built.statements, watermark: Math.max(watermark, ...built.revisions) };
    }
  }
}

export class PulseArchive {
  private coordinator: PulseArchiveCoordinator;
  private db: PulseArchiveDb;
  private chunkSize: number;
  private log: (stream: string, error: unknown) => void;

  constructor(options: {
    coordinator: PulseArchiveCoordinator;
    db: PulseArchiveDb;
    chunkSize?: number;
    log?: (stream: string, error: unknown) => void;
  }) {
    this.coordinator = options.coordinator;
    this.db = options.db;
    this.chunkSize = options.chunkSize ?? CHUNK_SIZE;
    this.log = options.log ?? ((stream, error) => console.warn("[pulse-archive]", stream, reason(error)));
  }

  async run(snapshot: PulseArchiveSnapshot): Promise<void> {
    for (const stream of snapshot.streams) {
      try {
        if (stream.error) throw new Error(stream.error);
        const built = archiveStatements(this.db, stream, snapshot.now);
        for (let at = 0; at < built.statements.length; at += this.chunkSize) {
          await this.db.batch(built.statements.slice(at, at + this.chunkSize));
        }
        if (built.watermark > stream.watermark || built.replaceToken) {
          await this.coordinator.confirmPulseArchive(stream.stream, built.watermark, built.replaceToken);
        }
      } catch (error) {
        this.log(stream.stream, error);
      }
    }
  }
}
