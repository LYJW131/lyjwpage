import {
  DAY_MS,
  parsedJson,
  revisionOf,
  siteDate,
  siteDayStart,
  type PulseArchiveDb,
  type PulseArchiveStreamSnapshot,
} from "./pulse-archive-snapshot";
import { coveringPart, parseStoredCodingBuckets, type StoredCodingBuckets } from "@shared/coding-buckets";
import { isCodingUsageSource, isOtlpCodingSource } from "@shared/coding-usage-sources";
import type { StoredCodingUsageAgent } from "@shared/coding-usage-view";
import type { HistoryStatement } from "@shared/history-ingest";
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
// 下界让删除走 started_at 主键的区间扫描；归档只收不超过它的桶，保证与范围重叠的行都落在下界之内。
const ACTIVITY_BUCKET_MAX_MS = 24 * 60 * 60 * 1000;
const DELETE_ACTIVITY_RANGE = `DELETE FROM activity_buckets WHERE started_at < ? AND started_at >= ? AND ended_at > ?
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
        if (!isOtlpCodingSource(source) && !coveringPart(stored.coverage, window.from)) continue;
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
      // 同一次刷新里新播的几首共用 (since, t]，主键是 (source, started_at)：按播放先后各加 0、1、2… 毫秒。
      const seen = new Map<string, number>();
      return {
        statements: rows.map((row) => {
          const refresh = `${row.since}:${row.t}`;
          const order = seen.get(refresh) ?? 0;
          seen.set(refresh, order + 1);
          return db.prepare(INSERT_LISTENING_PLAY).bind("recent", row.since + order, row.t, 0, row.title, row.artist, row.album, null, row.itemId);
        }),
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
      const buckets = parsedRows(snapshot.rows, parseActivityBucket).filter((bucket: ActivityBucket) => bucket.from < range.to && bucket.to > range.from && bucket.to - bucket.from <= ACTIVITY_BUCKET_MAX_MS);
      const json = JSON.stringify(buckets);
      return {
        statements: [
          db.prepare(CLAIM_ACTIVITY_REVISION).bind(snapshot.revision),
          db.prepare(DELETE_ACTIVITY_RANGE).bind(range.to, range.from - ACTIVITY_BUCKET_MAX_MS, range.from, json, snapshot.revision),
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
