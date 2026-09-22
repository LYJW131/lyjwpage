import { codingObservationsKey, codingTokenUsageKey } from "@/lib/coding-pulse";
import { listeningPlaysKey } from "@/lib/listening-pulse";
import { workoutsKey } from "@shared/workouts";
import { pulseAssessmentsKey, pulseAssessmentAttemptKey } from "@/lib/pulse-assessments";
import { pulseIntervalRevisionKey, pulseKey } from "@/lib/pulse";
import { PULSE_TTL_MS } from "@/lib/limits";
import { PULSE_DOMAINS, type PulseDomain } from "@/lib/types";
import { CODING_WINDOW_MS } from "@shared/pulse-coding";
import { parsePulseAssessment, type PulseAssessment } from "@shared/pulse-assessment";
import type { StorageCommand } from "@shared/storage-contract";

type SqlValue = string | number | null;

export interface PulseStateSql {
  exec(query: string, ...bindings: SqlValue[]): { toArray(): Record<string, unknown>[] };
}

export type PulseScoreInputs = {
  assessments: string[];
  codingObservations: string[];
  codingTokenUsage: string | null;
  listeningPlays: string[];
  /** `workouts:recent` 的整份 JSON；没有上报时为 null。 */
  workouts: string | null;
  histories: Record<PulseDomain, string[]>;
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
  activityRevision?: number;
};

type PersistentState = {
  generation: number;
  attemptedAt: number;
  claim: ActiveClaim | null;
};

const STATE_KEY = "pulse-score:state";
const MAX_ASSESSMENTS = 2016 * PULSE_DOMAINS.length;

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
      const commands: StorageCommand[] = [
        { op: "listRange", key: pulseAssessmentsKey(), start: 0, stop: -1 },
        { op: "listRange", key: codingObservationsKey(), start: 0, stop: -1 },
        { op: "get", key: codingTokenUsageKey() },
        { op: "listRange", key: listeningPlaysKey(), start: 0, stop: -1 },
        { op: "get", key: workoutsKey() },
        ...PULSE_DOMAINS.map((domain): StorageCommand => ({
          op: "listRange",
          key: pulseKey(domain),
          start: 0,
          stop: -1,
        })),
        { op: "get", key: pulseIntervalRevisionKey("activity") },
      ];
      const results = this.execute(commands);
      const histories = Object.fromEntries(PULSE_DOMAINS.map((domain, index) => [
        domain,
        results[index + 5] as string[],
      ])) as Record<PulseDomain, string[]>;
      const activityRevision = Number(results[results.length - 1]);
      const versionedClaim = { ...claim, activityRevision: Number.isSafeInteger(activityRevision) ? activityRevision : 0 };
      this.save({ ...this.load(), claim: versionedClaim });
      return {
        ...versionedClaim,
        now,
        inputs: {
          assessments: results[0] as string[],
          codingObservations: results[1] as string[],
          codingTokenUsage: results[2] as string | null,
          listeningPlays: results[3] as string[],
          workouts: results[4] as string | null,
          histories,
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
      let accepted = records.map((record) => parsePulseAssessment(JSON.stringify(record)));
      if (accepted.some((record) => record === null)) throw new Error("Invalid pulse assessment result");
      const currentRevision = Number(this.execute([{ op: "get", key: pulseIntervalRevisionKey("activity") }])[0]);
      if ((Number.isSafeInteger(currentRevision) ? currentRevision : 0) !== (state.claim.activityRevision ?? 0)) {
        accepted = accepted.filter((record) => record?.domain !== "activity");
      }

      const current = (this.execute([{
        op: "listRange",
        key: pulseAssessmentsKey(),
        start: 0,
        stop: -1,
      }])[0] as string[])
        .map(parsePulseAssessment)
        .filter((record): record is PulseAssessment => record !== null && record.to > now - PULSE_TTL_MS);
      const merged = new Map(current.map((record) => [`${record.domain}:${record.from}`, record]));
      for (const record of accepted as PulseAssessment[]) merged.set(`${record.domain}:${record.from}`, record);
      const ordered = [...merged.values()]
        .sort((a, b) => a.from - b.from || PULSE_DOMAINS.indexOf(a.domain) - PULSE_DOMAINS.indexOf(b.domain))
        .slice(-MAX_ASSESSMENTS);
      const writes: StorageCommand[] = [
        { op: "remove", key: pulseAssessmentsKey() },
      ];
      const serialized = ordered.map((record) => JSON.stringify(record));
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
