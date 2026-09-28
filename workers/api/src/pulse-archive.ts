import { codingObservationsKey, codingTokenUsageKey, cursorObservationsKey } from "@/lib/coding-pulse";
import {
  pulseActivityKey,
  pulseActivityRangeKey,
  pulseActivityRevisionKey,
  pulseChargingKey,
  pulseLaneKey,
  pulseListeningTracesKey,
} from "@/lib/pulse-keys";
import { key } from "@/lib/storage";
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
import { parseCodingTokenUsage } from "@shared/coding-token-usage";
import type { StorageCommand } from "@shared/storage-contract";

/**
 * Pulse 事实时间线的长期归档（D1 `lyjwpage-history`，表见 migrations/0007）。
 *
 * 状态核心是唯一写入方：StateHub 每分钟给出一份有界快照（各路水位之后的新行，
 * 加上推导会话所需的一点上下文），普通 Worker 拼成幂等 upsert 写 D1，成功后
 * 再向 StateHub 确认水位。每一路独立：一路读坏、写坏不挡别的路。
 *
 * 旧的档位表 `pulse_samples` 不再写，原样保留。
 */

type SqlValue = string | number | null;
/** StateHub's metadata table. */
export interface ArchiveSql {
  exec(query: string, ...bindings: SqlValue[]): { toArray(): Record<string, unknown>[] };
}

export type PulseArchiveDb = HistoryDb;

/**
 * 归档的每一路，水位都存在 StateHub metadata 的 `pulse-archive:v2:<stream>`：
 * 区间按关闭时刻、样本按时刻、整份替换的报告按采集时刻，确认时只按 max 前进。
 */
export const ARCHIVE_STREAMS = [
  "listening",
  "listening-traces",
  "watching",
  "gaming",
  "charging",
  "activity",
  "coding",
  "tokens",
  "usage-mac",
  "usage-cursor",
  "usage-claude-cloud",
] as const;
export type ArchiveStream = (typeof ARCHIVE_STREAMS)[number];

export type PulseArchiveStreamSnapshot = {
  stream: ArchiveStream;
  /** StateHub 分配的单调快照版本；防止较旧的异步替换覆盖较新的修订 */
  revision: number;
  watermark: number;
  /** 列表键里水位之后的行（外加推导所需的上下文）；解析是 Worker 的事 */
  rows: string[];
  /** coding 那一路附带的 Cursor 账号观测 */
  extra?: string[];
  /** 单值键（token 报告、用量镜像）的整份 JSON */
  value?: string | null;
  replaceRange?: { from: number; to: number };
  /** 本次权威替换对应的 StateHub 版本；确认后同一份历史不再重复写 D1 */
  replaceToken?: string;
  /** 一路读坏只隔离在这一路 */
  error?: string;
};

export type PulseArchiveSnapshot = { now: number; streams: PulseArchiveStreamSnapshot[] };

/** RPC shape implemented by StateHub and consumed by the ordinary Worker executor. */
export interface PulseArchiveCoordinator {
  readPulseArchive(): Promise<PulseArchiveSnapshot>;
  confirmPulseArchive(stream: ArchiveStream, at: number, replaceToken?: string): Promise<number>;
}

const WATERMARK_PREFIX = "pulse-archive:v2:";
const REVISION_KEY = "pulse-archive:revision";
const ACTIVITY_REPLACED_KEY = "pulse-archive:v2:activity-replaced";
const DAY_MS = 24 * 60 * 60 * 1000;
/** 站点统计日是 Asia/Shanghai（UTC+8，不过夏令时），和 AI Coding 的用量日桶一致 */
const SITE_OFFSET_MS = 8 * 60 * 60 * 1000;
/** 看剧、打游戏、充电的一次会话最长回看这么久，会话起点不能被读的尾巴截掉 */
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

/**
 * Durable state half of Pulse archiving. It exposes one bounded snapshot RPC
 * with per-stream read isolation and monotonic acknowledgements; it never talks to D1.
 */
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
      case "listening": case "gaming": case "watching": {
        // 会话要从第一段算起：看剧、打游戏往回多读一点上下文
        const since = stream === "listening" ? watermark : watermark - SESSION_CONTEXT_MS;
        return { rows: this.readSince(pulseLaneKey(stream), since, "to") };
      }
      case "listening-traces":
        return { rows: this.readSince(pulseListeningTracesKey(), watermark, "t") };
      case "charging":
        return { rows: this.readSince(pulseChargingKey(), watermark - SESSION_CONTEXT_MS, "t") };
      case "coding": {
        // 当天的活跃秒数要从当天零点重算
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
        // 范围或事实版本没变就是 D1 已有的那一份；每分钟重放会白白删了又写几百行。
        const replaceToken = replaceRange ? JSON.stringify([revision ?? null, replaceRange.from, replaceRange.to]) : undefined;
        const pending = replaceToken !== undefined && replaceToken !== this.metadata(ACTIVITY_REPLACED_KEY);
        return pending ? { rows, replaceRange, replaceToken } : { rows: [] };
      }
      case "tokens":
        return { rows: [], value: this.execute([{ op: "get", key: codingTokenUsageKey() }])[0] as string | null };
      case "usage-mac":
        return { rows: [], value: this.execute([{ op: "get", key: key("vibecoding", "usage") }])[0] as string | null };
      case "usage-cursor":
        return { rows: [], value: this.execute([{ op: "get", key: key("vibecoding", "cursor-usage") }])[0] as string | null };
      case "usage-claude-cloud":
        return { rows: [], value: this.execute([{ op: "get", key: key("vibecoding", "claude-cloud-usage") }])[0] as string | null };
    }
  }

  /**
   * 列表按时间追加：从尾巴往回读，读到第一行已经不晚于 `since` 或读完整串为止。
   * 平时只读水位之后那几十行，归档停过几天也能一次补齐。
   */
  private readSince(listKey: string, since: number, field: "t" | "to"): string[] {
    for (let size = 256; ; size *= 4) {
      const rows = this.execute([{ op: "listRange", key: listKey, start: -size, stop: -1 }])[0] as string[];
      if (rows.length < size) return rows;
      let first: unknown = null;
      try { first = (JSON.parse(rows[0]) as Record<string, unknown>)[field]; } catch { return rows; }
      if (typeof first !== "number" || first <= since) return rows;
    }
  }

  async confirmPulseArchive(stream: ArchiveStream, at: number, replaceToken?: string): Promise<number> {
    if (!ARCHIVE_STREAMS.includes(stream) || !Number.isSafeInteger(at) || at < 0 ||
        (replaceToken !== undefined && (stream !== "activity" || typeof replaceToken !== "string"))) {
      throw new Error("Invalid Pulse archive confirmation");
    }
    // 较旧的任务晚确认只会让下一分钟多做一次无变化的替换，D1 的范围版本保证不回退数据。
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

// ---------------------------------------------------------------- statements

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
// 新快照里仍在的桶交给下面的 upsert，只删真正消失的；未变的行不产生 D1 写入。
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
const UPSERT_ACTIVE_SECONDS = `INSERT INTO agent_usage_days(date, agent, model, active_seconds) VALUES (?, ?, ?, ?)
  ON CONFLICT(date, agent, model) DO UPDATE SET active_seconds = MAX(COALESCE(agent_usage_days.active_seconds, 0), excluded.active_seconds)
  WHERE agent_usage_days.active_seconds IS NULL OR excluded.active_seconds > agent_usage_days.active_seconds`;
const UPSERT_TOKEN_BUCKETS = `INSERT INTO coding_token_buckets(bucket_at, agent, model, input_tokens, output_tokens, cache_read_tokens,
    cache_creation_tokens, reasoning_tokens, event_count)
  SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]'), json_extract(value, '$[3]'),
    json_extract(value, '$[4]'), json_extract(value, '$[5]'), json_extract(value, '$[6]'), json_extract(value, '$[7]'),
    json_extract(value, '$[8]') FROM json_each(?) WHERE true
  ON CONFLICT(bucket_at, agent, model) DO UPDATE SET input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens,
    cache_read_tokens = excluded.cache_read_tokens, cache_creation_tokens = excluded.cache_creation_tokens,
    reasoning_tokens = excluded.reasoning_tokens, event_count = excluded.event_count
  WHERE coding_token_buckets.input_tokens IS NOT excluded.input_tokens OR coding_token_buckets.output_tokens IS NOT excluded.output_tokens
    OR coding_token_buckets.cache_read_tokens IS NOT excluded.cache_read_tokens OR coding_token_buckets.cache_creation_tokens IS NOT excluded.cache_creation_tokens
    OR coding_token_buckets.reasoning_tokens IS NOT excluded.reasoning_tokens OR coding_token_buckets.event_count IS NOT excluded.event_count`;
/** 五分钟桶按站点日（UTC+8）汇总成每天 × agent × 模型；只重算这次报告碰到的那几天 */
const ROLLUP_TOKEN_DAYS = `INSERT INTO agent_usage_days(date, agent, model, input_tokens, output_tokens, cache_read_tokens,
    cache_creation_tokens, reasoning_tokens, total_tokens, event_count)
  SELECT date(bucket_at / 1000 + 28800, 'unixepoch'), agent, model, SUM(input_tokens), SUM(output_tokens), SUM(cache_read_tokens),
    SUM(cache_creation_tokens), SUM(reasoning_tokens), SUM(input_tokens + output_tokens + cache_read_tokens + cache_creation_tokens), SUM(event_count)
  FROM coding_token_buckets WHERE bucket_at >= ? AND bucket_at < ?
  GROUP BY 1, 2, 3
  ON CONFLICT(date, agent, model) DO UPDATE SET input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens,
    cache_read_tokens = excluded.cache_read_tokens, cache_creation_tokens = excluded.cache_creation_tokens,
    reasoning_tokens = excluded.reasoning_tokens, total_tokens = excluded.total_tokens, event_count = excluded.event_count
  WHERE agent_usage_days.input_tokens IS NOT excluded.input_tokens OR agent_usage_days.output_tokens IS NOT excluded.output_tokens
    OR agent_usage_days.cache_read_tokens IS NOT excluded.cache_read_tokens OR agent_usage_days.cache_creation_tokens IS NOT excluded.cache_creation_tokens
    OR agent_usage_days.reasoning_tokens IS NOT excluded.reasoning_tokens OR agent_usage_days.event_count IS NOT excluded.event_count`;
/** 每天每个 agent 的合计（model = '*'）：token 分类与 API 等值费用。费用只有这一级，没有按模型的 */
const UPSERT_AGENT_DAYS = `INSERT INTO agent_usage_days(date, agent, model, input_tokens, output_tokens, cache_read_tokens,
    cache_creation_tokens, total_tokens, cost_usd)
  SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), '*', json_extract(value, '$[2]'), json_extract(value, '$[3]'),
    json_extract(value, '$[4]'), json_extract(value, '$[5]'), json_extract(value, '$[6]'), json_extract(value, '$[7]')
  FROM json_each(?) WHERE true
  ON CONFLICT(date, agent, model) DO UPDATE SET input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens,
    cache_read_tokens = excluded.cache_read_tokens, cache_creation_tokens = excluded.cache_creation_tokens,
    total_tokens = excluded.total_tokens, cost_usd = excluded.cost_usd
  WHERE agent_usage_days.input_tokens IS NOT excluded.input_tokens OR agent_usage_days.output_tokens IS NOT excluded.output_tokens
    OR agent_usage_days.cache_read_tokens IS NOT excluded.cache_read_tokens OR agent_usage_days.cache_creation_tokens IS NOT excluded.cache_creation_tokens
    OR agent_usage_days.total_tokens IS NOT excluded.total_tokens OR agent_usage_days.cost_usd IS NOT excluded.cost_usd`;
/** 云端日桶只给每个模型的总 token，没有分类 */
const UPSERT_MODEL_TOTALS = `INSERT INTO agent_usage_days(date, agent, model, total_tokens)
  SELECT json_extract(value, '$[0]'), json_extract(value, '$[1]'), json_extract(value, '$[2]'), json_extract(value, '$[3]')
  FROM json_each(?) WHERE true
  ON CONFLICT(date, agent, model) DO UPDATE SET total_tokens = excluded.total_tokens
  WHERE agent_usage_days.total_tokens IS NOT excluded.total_tokens`;

type Statement = HistoryStatement;
type Built = { statements: Statement[]; watermark: number; replaceToken?: string };

function parsedRows<T>(rows: string[], parse: (raw: string) => T | null): T[] {
  return rows.flatMap((raw) => {
    const row = parse(raw);
    return row ? [row] : [];
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * 相邻、首尾相接、同一条目的非空闲区间并成一次会话（看剧的播放 + 暂停、同一个游戏）。
 * 只要会话里有一段晚于水位就重写整次会话：它可能是上一分钟那次的延续。
 */
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

/**
 * Coding 观测按站点日切片后的活跃秒数：每条观测撑到下一条或 3 分钟（取早），
 * 和三色带、Jev 同一套切片。agent × 模型各一行，外加每个 agent 的合计（model = '*'，
 * 同一时刻多个模型只算一次）。Cursor 的活跃来自账号观测，没有模型。
 */
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

type UsageDay = { date: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number; totalTokens: number; apiEquivalentCostUSD: number; models?: { model: string; tokens: number }[] };

function usageDay(value: unknown): UsageDay | null {
  const row = record(value);
  if (!row || typeof row.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) return null;
  const keys = ["inputTokens", "outputTokens", "cacheReadTokens", "cacheCreationTokens", "totalTokens", "apiEquivalentCostUSD"] as const;
  if (!keys.every((k) => finite(row[k]) != null)) return null;
  const models = Array.isArray(row.models)
    ? row.models.flatMap((item) => {
      const model = record(item);
      return model && typeof model.model === "string" && finite(model.tokens) != null ? [{ model: model.model.slice(0, 80), tokens: model.tokens as number }] : [];
    })
    : undefined;
  return { ...(Object.fromEntries(keys.map((k) => [k, row[k]])) as Omit<UsageDay, "date" | "models">), date: row.date, models };
}

function dayStatements(db: PulseArchiveDb, agent: string, days: UsageDay[]): Statement[] {
  if (!days.length) return [];
  const totals = days.map((day) => [day.date, agent, day.inputTokens, day.outputTokens, day.cacheReadTokens, day.cacheCreationTokens, day.totalTokens, day.apiEquivalentCostUSD]);
  const models = days.flatMap((day) => (day.models ?? []).map((model) => [day.date, agent, model.model, model.tokens]));
  return [
    db.prepare(UPSERT_AGENT_DAYS).bind(JSON.stringify(totals)),
    ...(models.length ? [db.prepare(UPSERT_MODEL_TOTALS).bind(JSON.stringify(models))] : []),
  ];
}

/** 一路的快照 → D1 语句与确认用的新水位。纯函数，测试直接喂 node:sqlite。 */
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
        // 专辑 / 歌单名放 album：列表条目不是单曲，没有曲名
        statements: rows.map((row) => db.prepare(INSERT_LISTENING_PLAY).bind("recent", row.since, row.t, 0, null, row.artist, row.title, null, row.itemId)),
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
          // 还在充的那一次也写：每分钟按新读数改写到它结束
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
    case "tokens": {
      const usage = snapshot.value ? parseCodingTokenUsage(JSON.parse(snapshot.value)) : null;
      if (!usage || usage.collectedAt <= watermark) return { statements: [], watermark };
      const rows = usage.windows.flatMap((window) => window.agents.map((agent) => [
        window.from, agent.id, agent.model ?? "", agent.inputTokens, agent.outputTokens, agent.cacheReadTokens,
        agent.cacheCreationTokens, agent.reasoningTokens, agent.eventCount,
      ]));
      return {
        statements: [
          ...(rows.length ? [db.prepare(UPSERT_TOKEN_BUCKETS).bind(JSON.stringify(rows))] : []),
          db.prepare(ROLLUP_TOKEN_DAYS).bind(siteDayStart(usage.from), siteDayStart(usage.to) + DAY_MS),
        ],
        watermark: usage.collectedAt,
      };
    }
    case "usage-mac": case "usage-cursor": case "usage-claude-cloud": {
      const root = snapshot.value ? record(JSON.parse(snapshot.value)) : null;
      const pushedAt = finite(root?.pushedAt);
      if (!root || pushedAt == null || pushedAt <= watermark) return { statements: [], watermark };
      let statements: Statement[] = [];
      if (snapshot.stream === "usage-mac") {
        const agents = Array.isArray(record(root.payload)?.agents) ? record(root.payload)!.agents as unknown[] : [];
        // Cursor 的日桶归容器那份（usage-cursor），Mac 那行只是旧版带出来的空壳
        statements = agents.flatMap((value) => {
          const agent = record(value);
          const today = usageDay(agent?.today);
          return agent && typeof agent.id === "string" && agent.id !== "cursor" && today ? dayStatements(db, agent.id.slice(0, 40), [today]) : [];
        });
      } else if (snapshot.stream === "usage-cursor") {
        const report = record(root.report);
        statements = dayStatements(db, "cursor", Array.isArray(report?.days) ? report.days.map(usageDay).filter((day) => day !== null) : []);
      } else {
        const usage = record(root.usage);
        statements = dayStatements(db, "claude-cloud", Array.isArray(usage?.days) ? usage.days.map(usageDay).filter((day) => day !== null) : []);
      }
      return { statements, watermark: pushedAt };
    }
  }
}

/**
 * Ordinary Worker half of Pulse archiving. Every statement is an idempotent upsert
 * (natural keys, INSERT OR IGNORE or DO UPDATE … WHERE changed), so concurrent runs
 * may safely replay a stream. A stream's watermark advances only after all of its
 * statements succeeded.
 */
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

  /** One stream failing does not block the others. */
  async run(): Promise<void> {
    const snapshot = await this.coordinator.readPulseArchive();
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
