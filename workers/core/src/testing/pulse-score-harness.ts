import { DatabaseSync } from "node:sqlite";
import { codingObservationsKey } from "../coding-pulse";
import { mergeBucketReport } from "@shared/coding-buckets";
import type { CodingTokenBucketReport } from "@shared/coding-usage";
import { PULSE_SCORE_WINDOW_MS } from "@shared/pulse-coding";
import { SqliteStore, type SqlDatabase } from "@shared/sqlite-store";
import { StorageClient } from "@shared/storage-client";
import type { StorageCommand } from "@shared/storage-contract";
import { PulseScorer, type PulseDecide } from "../pulse-score.ts";
import { PulseScoreState } from "../pulse-score-state.ts";

export const T = 1_800_000_000_000;
type LegacyShape = { from: number; to: number; collectedAt: number; sources: { id: string; state: string }[]; windows: { from: number; to?: number; agents: unknown[] }[] };
export function storedBuckets(report: LegacyShape): string {
  const shaped = { from: report.from, to: report.to, collectedAt: report.collectedAt, agents: report.sources,
    windows: report.windows.map((window) => ({ from: window.from, agents: window.agents })) } as unknown as CodingTokenBucketReport;
  return JSON.stringify(mergeBucketReport(null, shaped, report.collectedAt));
}
export function setup() {
  let now = T + PULSE_SCORE_WINDOW_MS + 120_000;
  const db = new DatabaseSync(":memory:");
  const sql = {
    exec(query: string, ...args: (string | number | null)[]) {
      if (!args.length && query.includes(";")) { db.exec(query); return { toArray: () => [], rowsWritten: 0 }; }
      const statement = db.prepare(query);
      if (statement.columns().length) return { toArray: () => statement.all(...args) as Record<string, unknown>[], rowsWritten: 0 };
      const result = statement.run(...args);
      return { toArray: () => [], rowsWritten: Number(result.changes) };
    },
  } as unknown as SqlDatabase;
  const transaction = <TResult>(work: () => TResult): TResult => {
    db.exec("BEGIN");
    try { const result = work(); db.exec("COMMIT"); return result; }
    catch (error) { db.exec("ROLLBACK"); throw error; }
  };
  const store = new SqliteStore(sql, transaction, () => now);
  db.exec("CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  let unreachable = false;
  const execute = (commands: StorageCommand[]): unknown[] => {
    if (unreachable) throw new Error("fake storage unreachable");
    return store.execute(commands);
  };
  const storage = Object.assign(new StorageClient(async (commands) => execute(commands)), {
    async append(key: string, ...values: string[]): Promise<number> {
      return execute([{ op: "append", key, values }])[0] as number;
    },
    setUnreachable(value = true): void { unreachable = value; },
  });
  const requests: Record<string, unknown>[] = [];
  const errors: unknown[] = [];
  let fail = false;
  let nextToken = 0;
  const decide: PulseDecide = async (body) => {
    requests.push(body);
    if (fail) throw new Error("AI 503");
    return { model: "clef", answers: Object.fromEntries(Object.entries(body.questions).map(([id, question]) => {
      const q = question as { type: string; criteria: string[] | Record<string, string> };
      if (q.type === "choice") {
        const keys = Object.keys(q.criteria); const pick = keys.includes("mixed") ? "mixed" : keys[keys.length - 1];
        return [id, { type: "choice", choice: pick, confidence: 1, probabilities: Object.fromEntries(keys.map((k) => [k, k === pick ? 1 : 0])) }];
      }
      const levels = q.criteria as string[];
      return [id, { type: "score", score: levels.length - 1, confidence: 1,
        probabilities: Object.fromEntries(levels.map((_, i) => [String(i), i === levels.length - 1 ? 1 : 0])) }];
    })) };
  };
  const coordinator = () => new PulseScoreState({ sql, execute, now: () => now, token: () => `claim-${++nextToken}` });
  const make = () => {
    const state = coordinator();
    const scorer = new PulseScorer({ coordinator: state, decide, log: (e) => errors.push(e) });
    return { run: async () => scorer.run(await state.claimPulseScore().catch((error: unknown) => (errors.push(error), null))) };
  };
  const push = (at: number, available = true) => storage.append(codingObservationsKey(), JSON.stringify({ t: at, available,
    desktop: { application: "Zed", coding: true }, agents: [{ id: "codex", model: "model", active: true }] }));
  return { storage, make, coordinator, push, requests, errors, now: () => now,
    advance: (ms: number) => { now += ms; }, fail: (value: boolean) => { fail = value; } };
}
