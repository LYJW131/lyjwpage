import { codingObservationsKey, cursorObservationsKey } from "@/lib/coding-pulse";
import { pulseAssessmentsKey, pulseAssessmentAttemptKey } from "@/lib/pulse-assessments";
import { PULSE_TTL_MS } from "@/lib/limits";
import { codingBucketsKey } from "@shared/coding-store";
import { CODING_USAGE_SOURCE_NAMES, type CodingUsageSource } from "@shared/coding-usage-sources";
import { CODING_WINDOW_MS } from "@shared/pulse-coding";
import { latestPulseAssessments, parsePulseAssessment, type PulseAssessment } from "@shared/pulse-assessment";
import type { StorageCommand } from "@shared/storage-contract";

type SqlValue = string | number | null;

export interface PulseStateSql {
  exec(query: string, ...bindings: SqlValue[]): { toArray(): Record<string, unknown>[] };
}

/** Jev 只给 Coding 打分，快照里只有 Coding 的原始证据和已有评估。 */
export type PulseScoreInputs = {
  assessments: string[];
  codingObservations: string[];
  /** 各来源的 5 分钟 token 桶（`pulse:token-buckets:<来源>`，shared/coding-buckets），没有是 null */
  tokenBuckets: Record<CodingUsageSource, string | null>;
  cursorObservations: string[];
};

export type PulseScoreClaim = {
  token: string;
  generation: number;
  /** DO server time used to freeze the scoring windows and scoredAt for this run. */
  now: number;
  leaseUntil: number;
  inputs: PulseScoreInputs;
};

/** RPC shape implemented by StateHub and consumed by the ordinary Worker executor. */
export interface PulseScoreCoordinator {
  claimPulseScore(): Promise<PulseScoreClaim | null>;
  activatePulseScore(token: string, generation: number): Promise<boolean>;
  finishPulseScore(token: string, generation: number, records: PulseAssessment[]): Promise<boolean>;
};

type ActiveClaim = {
  token: string;
  generation: number;
  leaseUntil: number;
  activatedAt?: number;
};

type PersistentState = {
  generation: number;
  attemptedAt: number;
  claim: ActiveClaim | null;
};

const STATE_KEY = "pulse-score:state";
/** 七天的十五分钟窗口是 672 行；留到从前五分钟窗口的量，旧行压缩前也放得下 */
const MAX_ASSESSMENTS = 2016;
/**
 * 评估平时只追加这一轮新评的几行；列表里被覆盖的旧行和过期行多过有效行的一半、或者总行数
 * 超过上限的一倍半，才整表压缩重写一次。从前每轮都整表重写：七天攒满一万两千行，每五分钟
 * 删一遍再写一遍，一天七百万行写入，远超套餐的每月五千万。现在平时一天几千行，压缩约三天一次。
 */
const COMPACT_GARBAGE_RATIO = 0.5;
const COMPACT_MAX_ROWS = MAX_ASSESSMENTS * 1.5;

/**
 * 36 jobs / 3 concurrent requests / 10 second request timeout has a 120 second
 * worst-case request budget. The remaining minute covers preparation and RPCs,
 * while keeping a crashed claim bounded.
 */
export const PULSE_SCORE_LEASE_MS = 180_000;

type StorageExecutor = (commands: StorageCommand[]) => unknown[];

function defaultState(attemptedAt = 0): PersistentState {
  return { generation: 0, attemptedAt, claim: null };
}

/**
 * Durable coordination only: claim a snapshot, persist submit eligibility, and
 * merge accepted results. Feature extraction and model I/O stay in the Worker.
 * All mutations are synchronous so no other DO event can replace a claim between
 * eligibility validation and the authoritative SQLite write.
 */
export class PulseScoreState implements PulseScoreCoordinator {
  private sql: PulseStateSql;
  private execute: StorageExecutor;
  private now: () => number;
  private token: () => string;

  constructor(options: {
    sql: PulseStateSql;
    execute: StorageExecutor;
    now?: () => number;
    token?: () => string;
  }) {
    this.sql = options.sql;
    this.execute = options.execute;
    this.now = options.now ?? Date.now;
    this.token = options.token ?? (() => crypto.randomUUID());
  }

  async claimPulseScore(): Promise<PulseScoreClaim | null> {
    const now = this.now();
    const state = this.load();
    if (state.claim && state.claim.leaseUntil > now) return null;
    if (now - state.attemptedAt < CODING_WINDOW_MS) return null;

    const generation = state.generation + 1;
    const claim: ActiveClaim = {
      token: this.token(),
      generation,
      leaseUntil: now + PULSE_SCORE_LEASE_MS,
    };
    this.save({ ...state, generation, claim });

    try {
      const results = this.execute([
        { op: "listRange", key: pulseAssessmentsKey(), start: 0, stop: -1 },
        { op: "listRange", key: codingObservationsKey(), start: 0, stop: -1 },
        { op: "listRange", key: cursorObservationsKey(), start: 0, stop: -1 },
        ...CODING_USAGE_SOURCE_NAMES.map((source): StorageCommand => ({ op: "get", key: codingBucketsKey(source) })),
      ]);
      return {
        ...claim,
        now,
        inputs: {
          assessments: results[0] as string[],
          codingObservations: results[1] as string[],
          cursorObservations: results[2] as string[],
          tokenBuckets: Object.fromEntries(CODING_USAGE_SOURCE_NAMES.map((source, index) => [source, results[3 + index] as string | null])) as PulseScoreInputs["tokenBuckets"],
        },
      };
    } catch (error) {
      this.releaseIfOwned(claim.token, claim.generation);
      throw error;
    }
  }

  async activatePulseScore(token: string, generation: number): Promise<boolean> {
    const now = this.now();
    const state = this.load();
    if (!this.owns(state, token, generation) || state.claim.leaseUntil <= now) return false;
    if (state.claim.activatedAt !== undefined) return true;
    this.save({
      ...state,
      attemptedAt: now,
      claim: { ...state.claim, activatedAt: now, leaseUntil: now + PULSE_SCORE_LEASE_MS },
    });
    return true;
  }

  async finishPulseScore(token: string, generation: number, records: PulseAssessment[]): Promise<boolean> {
    const now = this.now();
    const state = this.load();
    if (!this.owns(state, token, generation) || state.claim.leaseUntil <= now) return false;
    if (records.length && state.claim.activatedAt === undefined) return false;

    if (records.length) {
      const accepted = records.map((record) => parsePulseAssessment(JSON.stringify(record)));
      if (accepted.some((record) => record === null)) throw new Error("Invalid pulse assessment result");

      const raw = this.execute([{
        op: "listRange",
        key: pulseAssessmentsKey(),
        start: 0,
        stop: -1,
      }])[0] as string[];
      const current = latestPulseAssessments(raw).filter((record) => record.to > now - PULSE_TTL_MS);
      const merged = new Map(current.map((record) => [`${record.domain}:${record.from}`, record]));
      for (const record of accepted as PulseAssessment[]) merged.set(`${record.domain}:${record.from}`, record);
      const ordered = [...merged.values()]
        .sort((a, b) => a.from - b.from)
        .slice(-MAX_ASSESSMENTS);
      // 追加之后列表会有多少行、其中多少是被覆盖或过期的
      const rows = raw.length + accepted.length;
      const compact = rows - ordered.length > ordered.length * COMPACT_GARBAGE_RATIO || rows > COMPACT_MAX_ROWS;
      const writes: StorageCommand[] = [];
      const serialized = (compact ? ordered : accepted as PulseAssessment[]).map((record) => JSON.stringify(record));
      if (compact) writes.push({ op: "remove", key: pulseAssessmentsKey() });
      for (let at = 0; at < serialized.length; at += 10_000) {
        writes.push({ op: "append", key: pulseAssessmentsKey(), values: serialized.slice(at, at + 10_000) });
      }
      writes.push({ op: "expire", key: pulseAssessmentsKey(), ttlMs: PULSE_TTL_MS });
      this.execute(writes);
    }

    this.releaseIfOwned(token, generation);
    return true;
  }

  private owns(state: PersistentState, token: string, generation: number): state is PersistentState & { claim: ActiveClaim } {
    return state.claim?.token === token && state.claim.generation === generation;
  }

  private releaseIfOwned(token: string, generation: number): void {
    const state = this.load();
    if (this.owns(state, token, generation)) this.save({ ...state, claim: null });
  }

  private load(): PersistentState {
    const raw = this.sql.exec("SELECT value FROM metadata WHERE key = ?", STATE_KEY).toArray()[0]?.value;
    if (typeof raw !== "string") {
      const legacyAttempt = Number(this.execute([{ op: "get", key: pulseAssessmentAttemptKey() }])[0]);
      return defaultState(Number.isFinite(legacyAttempt) && legacyAttempt > 0 ? legacyAttempt : 0);
    }
    try {
      const parsed = JSON.parse(raw) as Partial<PersistentState>;
      const generation = Number(parsed.generation);
      const attemptedAt = Number(parsed.attemptedAt);
      const claim = parsed.claim;
      if (!Number.isSafeInteger(generation) || generation < 0 || !Number.isFinite(attemptedAt) || attemptedAt < 0) return defaultState();
      if (claim !== null && claim !== undefined && (
        typeof claim.token !== "string" || !claim.token || claim.generation !== generation ||
        !Number.isFinite(claim.leaseUntil) || claim.leaseUntil < 0 ||
        (claim.activatedAt !== undefined && (!Number.isFinite(claim.activatedAt) || claim.activatedAt < 0))
      )) return defaultState();
      return { generation, attemptedAt, claim: claim ?? null };
    } catch {
      return defaultState();
    }
  }

  private save(state: PersistentState): void {
    this.sql.exec(
      "INSERT INTO metadata(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      STATE_KEY,
      JSON.stringify(state),
    );
  }
}
