import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { codingObservationsKey, cursorObservationsKey } from "@/lib/coding-pulse";
import { pulseChargingKey, pulseLaneOpenKey, pulseListeningTracesKey } from "@/lib/pulse-keys";
import { installStorageForTests, resetStorageForTests } from "@/lib/storage";
import type { CodingBucketDelta } from "@shared/coding-buckets";
import type { CodingTokenBucketReport, CodingUsageAgent, CodingUsageDay } from "@shared/coding-usage";
import type { CodingUsageSource } from "@shared/coding-usage-sources";
import type { HistoryDb } from "@shared/history-ingest";
import { SqliteStore, type SqlDatabase } from "@shared/sqlite-store";
import { StorageClient } from "@shared/storage-client";
import { prepareCodingBuckets, prepareOtlpBuckets } from "./stores/coding-buckets.ts";
import { prepareCodingUsage } from "./stores/coding-usage.ts";
import { recordChargingSample, recordStateObservation, replacePulseActivity } from "./stores/pulse.ts";
import { PulseArchive, PulseArchiveState, activeSecondsByDay, archiveStatements, siteDate, type ArchiveStream } from "./pulse-archive.ts";

const T0 = Date.UTC(2026, 8, 28, 2, 0, 0);
const M = 60_000;

type Statement = { query: string; values: unknown[] };

function setup(options: { failStream?: ArchiveStream } = {}) {
  let now = T0;
  const hub = new DatabaseSync(":memory:");
  const sql = {
    exec(query: string, ...args: (string | number | null)[]) {
      if (!args.length && query.includes(";")) { hub.exec(query); return { toArray: () => [], rowsWritten: 0 }; }
      const statement = hub.prepare(query);
      if (statement.columns().length) return { toArray: () => statement.all(...args) as Record<string, unknown>[], rowsWritten: 0 };
      const result = statement.run(...args);
      return { toArray: () => [], rowsWritten: Number(result.changes) };
    },
  } as unknown as SqlDatabase;
  const transaction = <T>(work: () => T): T => {
    hub.exec("BEGIN");
    try { const result = work(); hub.exec("COMMIT"); return result; } catch (error) { hub.exec("ROLLBACK"); throw error; }
  };
  const store = new SqliteStore(sql, transaction, () => now);
  hub.exec("CREATE TABLE metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
  const storage = new StorageClient(async (commands) => store.execute(commands));
  const state = new PulseArchiveState({ sql: sql as never, execute: (commands) => store.execute(commands), now: () => now });

  const d1 = new DatabaseSync(":memory:");
  const migrations = `${dirname(fileURLToPath(import.meta.url))}/../migrations/`;
  for (const file of readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort()) d1.exec(readFileSync(`${migrations}${file}`, "utf8"));
  let changes = 0;
  const db: HistoryDb = {
    prepare: (query) => {
      const statement: Statement & { bind(...values: unknown[]): typeof statement } = { query, values: [], bind: (...values) => ({ ...statement, values }) };
      return statement;
    },
    async batch(statements) {
      const list = statements as unknown as Statement[];
      if (options.failStream === "gaming" && list.some((row) => row.query.includes("game_sessions"))) throw new Error("D1 unavailable");
      d1.exec("BEGIN");
      try {
        for (const { query, values } of list) changes += Number(d1.prepare(query).run(...(values as (string | number | null)[])).changes);
        d1.exec("COMMIT");
      } catch (error) { d1.exec("ROLLBACK"); throw error; }
      return [];
    },
  };
  const logged: string[] = [];
  const archive = () => {
    const runner = new PulseArchive({ coordinator: state, db, log: (stream, error) => logged.push(`${stream}: ${error instanceof Error ? error.message : String(error)}`) });
    return { run: async () => runner.run(await state.readPulseArchive()) };
  };
  return {
    storage, state, archive, logged, db,
    at: (t: number) => { now = t; },
    all: (query: string) => d1.prepare(query).all().map((row) => ({ ...row })) as Record<string, unknown>[],
    exec: (query: string) => d1.exec(query),
    changes: () => changes,
    watermark: (stream: ArchiveStream) => (hub.prepare("SELECT value FROM metadata WHERE key = ?").get(`pulse-archive:v2:${stream}`) as { value?: string } | undefined)?.value ?? null,
    async write(run: () => Promise<unknown>) {
      installStorageForTests(storage);
      try { await run(); } finally { resetStorageForTests(); }
    },
  };
}

const music = (title: string, state: "playing" | "paused" | "idle" = "playing") => ({
  state, source: state === "idle" ? null : "mac" as const, title: state === "idle" ? null : title, artist: "Hamilton", album: "Hamilton", trackId: null,
});

test("pulse archive: closed playing intervals and recent-list traces become listening plays, idempotently", async () => {
  const b = setup();
  await b.write(async () => {
    await recordStateObservation("listening", T0, music("Helpless"));
    await recordStateObservation("listening", T0 + 3 * M, music("Helpless", "paused"));
    await recordStateObservation("listening", T0 + 5 * M, music("Satisfied"));
    await recordStateObservation("listening", T0 + 9 * M, { ...music("x", "idle"), artist: null, album: null });
    await b.storage.batch().append(pulseListeningTracesKey(),
      JSON.stringify({ since: T0 - 4 * M, t: T0 - 2 * M, title: "Yoru ni Kakeru", artist: "YOASOBI", album: "THE BOOK", itemId: "1" }),
      JSON.stringify({ since: T0 - 4 * M, t: T0 - 2 * M, title: "Idol", artist: "YOASOBI", album: "THE BOOK 2", itemId: "2", durationMs: 213_000 })).execute();
  });
  b.at(T0 + 10 * M);
  await b.archive().run();
  assert.deepEqual(b.logged, []);
  assert.deepEqual(b.all("SELECT source, started_at, ended_at, certain, title, album, item_id FROM listening_plays ORDER BY started_at"), [
    { source: "recent", started_at: T0 - 4 * M, ended_at: T0 - 2 * M, certain: 0, title: "Yoru ni Kakeru", album: "THE BOOK", item_id: "1" },
    { source: "recent", started_at: T0 - 4 * M + 1, ended_at: T0 - 2 * M, certain: 0, title: "Idol", album: "THE BOOK 2", item_id: "2" },
    { source: "mac", started_at: T0, ended_at: T0 + 3 * M, certain: 1, title: "Helpless", album: "Hamilton", item_id: null },
    { source: "mac", started_at: T0 + 5 * M, ended_at: T0 + 9 * M, certain: 1, title: "Satisfied", album: "Hamilton", item_id: null },
  ], "paused and idle spans are not plays; two songs from one refresh keep their order a millisecond apart");
  assert.equal(b.watermark("listening"), String(T0 + 9 * M));
  const before = b.changes();
  await b.archive().run();
  assert.equal(b.changes(), before, "a replay past the watermark writes nothing");
});

test("pulse archive: watching sessions merge playing and paused spans of one item and grow as they continue", async () => {
  const b = setup();
  const video = (state: "playing" | "paused" | "idle", itemId: string | null = "42") =>
    ({ state, itemId: state === "idle" ? null : itemId, title: state === "idle" ? null : "Frieren", subtitle: state === "idle" ? null : "S01E05" });
  await b.write(async () => {
    await recordStateObservation("watching", T0, video("playing"));
    await recordStateObservation("watching", T0 + 10 * M, video("paused"));
    await recordStateObservation("watching", T0 + 12 * M, video("playing"));
  });
  b.at(T0 + 13 * M);
  await b.archive().run();
  assert.deepEqual(b.all("SELECT item_id, started_at, ended_at, playing_seconds, title FROM watching_sessions"), [
    { item_id: "42", started_at: T0, ended_at: T0 + 12 * M, playing_seconds: 600, title: "Frieren" },
  ]);
  await b.write(async () => {
    await recordStateObservation("watching", T0 + 21 * M, video("playing"));
    await recordStateObservation("watching", T0 + 30 * M, video("idle"));
  });
  await b.archive().run();
  assert.deepEqual(b.all("SELECT item_id, started_at, ended_at, playing_seconds FROM watching_sessions"), [
    { item_id: "42", started_at: T0, ended_at: T0 + 30 * M, playing_seconds: 600 + 18 * 60 },
  ], "the same session row is extended, not duplicated");
});

test("pulse archive: in-game spans become game sessions; charging keeps samples and derives sessions", async () => {
  const b = setup();
  await b.write(async () => {
    await recordStateObservation("gaming", T0, { state: "online", titleId: null, title: null });
    await recordStateObservation("gaming", T0 + 5 * M, { state: "in-game", titleId: "PPSA01", title: "Pragmata" });
    await recordStateObservation("gaming", T0 + 35 * M, { state: "in-game", titleId: "PPSA01", title: "Pragmata" });
    await recordStateObservation("gaming", T0 + 65 * M, { state: "offline", titleId: null, title: null });
    await recordChargingSample(T0, 0, null);
    await recordChargingSample(T0 + M, 60, "MacBook Pro");
    await recordChargingSample(T0 + 6 * M, 60, "MacBook Pro");
    await recordChargingSample(T0 + 11 * M, 0.4, "MacBook Pro");
  });
  b.at(T0 + 70 * M);
  await b.archive().run();
  assert.deepEqual(b.all("SELECT title_id, started_at, ended_at, title FROM game_sessions"), [
    { title_id: "PPSA01", started_at: T0 + 5 * M, ended_at: T0 + 65 * M, title: "Pragmata" },
  ]);
  assert.deepEqual(b.all("SELECT t, watts FROM charging_samples ORDER BY t").map((row) => row.watts), [0, 60, 60, 0.4]);
  assert.deepEqual(b.all("SELECT started_at, ended_at, peak_w, energy_wh, device FROM charging_sessions"), [
    { started_at: T0 + M, ended_at: T0 + 11 * M, peak_w: 60, energy_wh: 10, device: "MacBook Pro" },
  ]);
});

test("pulse archive: authoritative activity replacement writes only changed rows and a newer revision wins", async () => {
  const b = setup();
  const range = { from: T0, to: T0 + 60 * M };
  const bucket = (offset: number, steps: number | null) => ({ from: T0 + offset * M, to: T0 + (offset + 5) * M, steps, moveKcal: 1, exerciseMinutes: null });
  await b.write(() => replacePulseActivity(range, [bucket(0, 300), bucket(5, 20)]));
  await b.archive().run();
  assert.deepEqual(b.all("SELECT started_at, steps, move_kcal, exercise_minutes FROM activity_buckets ORDER BY started_at"), [
    { started_at: T0, steps: 300, move_kcal: 1, exercise_minutes: null },
    { started_at: T0 + 5 * M, steps: 20, move_kcal: 1, exercise_minutes: null },
  ]);
  const before = b.changes();
  await b.archive().run();
  assert.equal(b.changes(), before, "an unchanged snapshot is not replayed");
  await b.write(() => replacePulseActivity(range, [bucket(0, 300), bucket(10, null)]));
  await b.archive().run();
  assert.deepEqual(b.all("SELECT started_at, steps FROM activity_buckets ORDER BY started_at"), [
    { started_at: T0, steps: 300 },
    { started_at: T0 + 10 * M, steps: null },
  ], "HealthKit's revision deletes the vanished bucket and leaves missing steps unknown");
  assert.equal(b.changes() - before, 3, "only the revision claim, the deleted and the new bucket are written");
});

test("pulse archive: activity replacement only deletes within the lower bound and archives no oversized bucket", async () => {
  const b = setup();
  const range = { from: T0, to: T0 + 60 * M };
  b.exec(`INSERT INTO activity_buckets(started_at, ended_at, steps) VALUES (${T0 - 3 * 24 * 60 * M}, ${T0 - 3 * 24 * 60 * M + 5 * M}, 1), (${T0 - 3 * M}, ${T0 + 2 * M}, 2)`);
  const bucket = (from: number, to: number, steps: number) => ({ from, to, steps, moveKcal: null, exerciseMinutes: null });
  await b.write(() => replacePulseActivity(range, [bucket(T0, T0 + 5 * M, 300), bucket(T0 + 10 * M, T0 + 10 * M + 25 * 60 * M, 7)]));
  await b.archive().run();
  assert.deepEqual(b.all("SELECT started_at, steps FROM activity_buckets ORDER BY started_at"), [
    { started_at: T0 - 3 * 24 * 60 * M, steps: 1 },
    { started_at: T0, steps: 300 },
  ]);
});

test("pulse archive: an older activity snapshot finishing late cannot undo a newer replacement", async () => {
  const b = setup();
  const range = { from: T0, to: T0 + 60 * M };
  const bucket = (offset: number, steps: number) => ({ from: T0 + offset * M, to: T0 + (offset + 5) * M, steps, moveKcal: null, exerciseMinutes: null });
  await b.write(() => replacePulseActivity(range, [bucket(0, 300), bucket(5, 20)]));
  const older = (await b.state.readPulseArchive()).streams.find((stream) => stream.stream === "activity")!;
  await b.write(() => replacePulseActivity(range, [bucket(0, 310)]));
  const newer = (await b.state.readPulseArchive()).streams.find((stream) => stream.stream === "activity")!;
  await b.db.batch(archiveStatements(b.db, newer, T0).statements);
  await b.db.batch(archiveStatements(b.db, older, T0).statements);
  assert.deepEqual(b.all("SELECT started_at, steps FROM activity_buckets"), [{ started_at: T0, steps: 310 }]);
});

function usageDay(date: string, totalTokens: number, models: Array<[string, number]>, extra: Partial<CodingUsageDay> = {}): CodingUsageDay {
  return {
    date, inputTokens: totalTokens, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0, totalTokens,
    apiEquivalentCostUSD: totalTokens / 100, costComplete: true, models: models.map(([model, tokens]) => ({ model, tokens })), ...extra,
  };
}

function ledger(id: string, days: CodingUsageDay[], collectedAt: number): CodingUsageAgent {
  return { id, state: "ok", collectedAt, error: null, warning: null, sessionCount: null, days };
}

function bucketReport(from: number, to: number, windows: Array<[number, number]>): CodingTokenBucketReport {
  return {
    from, to, collectedAt: to, agents: [{ id: "claude", state: "ok" }],
    windows: windows.map(([start, input]) => ({ from: start, agents: [{ id: "claude", model: "claude-opus", inputTokens: input, outputTokens: input, cacheReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0, eventCount: input }] })),
  };
}

type Harness = ReturnType<typeof setup>;

async function storeLedgers(b: Harness, source: CodingUsageSource, agents: CodingUsageAgent[], at: number, options: { derived?: boolean } = {}) {
  await b.write(async () => (await prepareCodingUsage(source, { agents }, at, options)).commit());
}

async function storeBuckets(b: Harness, source: "mac" | "agents", report: CodingTokenBucketReport, at: number) {
  await b.write(async () => (await prepareCodingBuckets(source, report, at)).commit());
}

async function storeOtlpBuckets(b: Harness, deltas: CodingBucketDelta[], at: number) {
  await b.write(async () => (await prepareOtlpBuckets(deltas, at)).commit());
}

test("pulse archive: coding observations and active seconds go to their own table; nothing rolls up into the old ones", async () => {
  const b = setup();
  const observation = (t: number, agents: { id: string; model: string | null; active: boolean }[]) =>
    JSON.stringify({ t, available: true, desktop: { application: "Zed", coding: true }, agents });
  await b.storage.batch()
    .append(codingObservationsKey(),
      observation(T0, [{ id: "claude", model: "claude-opus", active: true }, { id: "codex", model: "gpt", active: false }]),
      observation(T0 + 2 * M, [{ id: "claude", model: "claude-opus", active: true }, { id: "codex", model: "gpt", active: true }]),
      observation(T0 + 4 * M, [{ id: "claude", model: "claude-opus", active: false }]))
    .append(cursorObservationsKey(), JSON.stringify({ t: T0, available: true, lastActivityAt: T0 }))
    .execute();
  b.at(T0 + 7 * M);
  await b.archive().run();
  assert.deepEqual(b.logged, []);
  assert.equal(b.all("SELECT COUNT(*) AS n FROM coding_observations")[0].n, 3);
  assert.deepEqual(b.all("SELECT agent, model, active_seconds FROM coding_active_days ORDER BY agent, model"), [
    { agent: "claude", model: "*", active_seconds: 240 },
    { agent: "claude", model: "claude-opus", active_seconds: 240 },
    { agent: "codex", model: "*", active_seconds: 120 },
    { agent: "codex", model: "gpt", active_seconds: 120 },
    { agent: "cursor", model: "*", active_seconds: 300 },
  ]);
  assert.equal(b.all("SELECT COUNT(*) AS n FROM agent_usage_days")[0].n, 0, "the old table is frozen");
});

test("pulse archive: usage ledgers land per source, agent and day; only ledgers that changed since the watermark are rewritten", async () => {
  const b = setup();
  await storeLedgers(b, "mac", [
    ledger("claude", [usageDay("2026-09-27", 100, [["claude-opus", 60], ["claude-fable", 40]]), usageDay("2026-09-28", 0, [])], T0),
    ledger("cursor", [usageDay("2026-09-28", 999, [["composer-1", 999]])], T0),
  ], T0);
  await storeLedgers(b, "agents", [
    ledger("cursor", [usageDay("2026-09-28", 18, [["composer-2", 18]], { costComplete: false, reasoningTokens: 0 })], T0),
  ], T0);
  b.at(T0 + M);
  await b.archive().run();
  assert.deepEqual(b.logged, []);
  assert.deepEqual(b.all("SELECT date, source, agent, total_tokens, cost_usd, cost_complete FROM coding_usage_days ORDER BY source, agent, date"), [
    { date: "2026-09-28", source: "agents", agent: "cursor", total_tokens: 18, cost_usd: 0.18, cost_complete: 0 },
    { date: "2026-09-27", source: "mac", agent: "claude", total_tokens: 100, cost_usd: 1, cost_complete: 1 },
    { date: "2026-09-28", source: "mac", agent: "claude", total_tokens: 0, cost_usd: 0, cost_complete: 1 },
    { date: "2026-09-28", source: "mac", agent: "cursor", total_tokens: 999, cost_usd: 9.99, cost_complete: 1 },
  ]);
  assert.deepEqual(b.all("SELECT source, agent, model, tokens FROM coding_usage_models ORDER BY source, agent, model"), [
    { source: "agents", agent: "cursor", model: "composer-2", tokens: 18 },
    { source: "mac", agent: "claude", model: "claude-fable", tokens: 40 },
    { source: "mac", agent: "claude", model: "claude-opus", tokens: 60 },
    { source: "mac", agent: "cursor", model: "composer-1", tokens: 999 },
  ]);
  assert.equal(b.watermark("coding-usage"), "2", "the watermark is the ledger revision, not a time");

  const before = b.changes();
  b.at(T0 + 2 * M);
  await b.archive().run();
  assert.equal(b.changes(), before, "no new ledger since the watermark: nothing read, nothing written");

  await storeLedgers(b, "mac", [
    ledger("claude", [usageDay("2026-09-27", 100, [["claude-opus", 60], ["claude-fable", 40]]), usageDay("2026-09-28", 30, [["claude-opus", 30]])], T0 + 3 * M),
  ], T0 + 3 * M);
  b.at(T0 + 4 * M);
  await b.archive().run();
  assert.equal(b.changes() - before, 5, "claude's two day rows and three model rows, nothing else");
  assert.equal(b.all("SELECT total_tokens FROM coding_usage_days WHERE source = 'mac' AND agent = 'claude' AND date = '2026-09-28'")[0].total_tokens, 30);
  assert.equal(b.watermark("coding-usage"), "3");
});

test("pulse archive: token buckets from every source; a later report's partial first window never overwrites a complete bucket", async () => {
  const b = setup();
  await storeBuckets(b, "mac", bucketReport(T0, T0 + 10 * M, [[T0, 30], [T0 + 5 * M, 12]]), T0 + 10 * M);
  await storeOtlpBuckets(b, [
    { at: T0 + M, id: "claude", model: "claude-fable", inputTokens: 5, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 },
  ], T0 + 2 * M);
  b.at(T0 + 10 * M);
  await b.archive().run();
  await storeBuckets(b, "mac", bucketReport(T0 + 2 * M, T0 + 12 * M, [[T0, 4], [T0 + 5 * M, 20], [T0 + 10 * M, 1]]), T0 + 12 * M);
  b.at(T0 + 12 * M);
  await b.archive().run();
  assert.deepEqual(b.logged, []);
  assert.deepEqual(b.all("SELECT bucket_at, source, input_tokens, event_count FROM coding_usage_buckets ORDER BY source, bucket_at"), [
    { bucket_at: T0, source: "agents-otlp", input_tokens: 5, event_count: null },
    { bucket_at: T0, source: "mac", input_tokens: 30, event_count: 30 },
    { bucket_at: T0 + 5 * M, source: "mac", input_tokens: 20, event_count: 20 },
    { bucket_at: T0 + 10 * M, source: "mac", input_tokens: 1, event_count: 1 },
  ]);
  assert.equal(b.all("SELECT COUNT(*) AS n FROM agent_usage_days")[0].n, 0, "buckets never roll up into days");
});

test("pulse archive: a cloud commit received earlier but committed after the archive ran is still archived", async () => {
  const b = setup();
  const claude = (tokens: number, collectedAt: number): CodingUsageAgent => ({
    id: "claude", state: "ok", collectedAt, error: null, warning: null, sessionCount: 1,
    days: [usageDay("2026-09-28", tokens, [["claude-fable", tokens]])],
  });
  const delta = (tokens: number): CodingBucketDelta => ({ at: T0, id: "claude", model: "claude-fable", inputTokens: tokens, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 });
  await storeLedgers(b, "agents-otlp", [claude(50, T0 + 1_000)], T0 + 1_000, { derived: true });
  await storeOtlpBuckets(b, [delta(50)], T0 + 1_000);
  b.at(T0 + M);
  await b.archive().run();
  await storeLedgers(b, "agents-otlp", [claude(150, T0 + 1_000)], T0, { derived: true });
  await storeOtlpBuckets(b, [delta(100)], T0);
  b.at(T0 + 2 * M);
  await b.archive().run();
  assert.deepEqual(b.logged, []);
  assert.deepEqual(b.all("SELECT total_tokens FROM coding_usage_days WHERE source = 'agents-otlp'"), [{ total_tokens: 150 }]);
  assert.deepEqual(b.all("SELECT input_tokens FROM coding_usage_buckets WHERE source = 'agents-otlp'"), [{ input_tokens: 150 }]);
  assert.equal(b.watermark("coding-usage"), "2");
  assert.equal(b.watermark("coding-buckets"), "2");
});

test("pulse archive: two overlapping runs where the older snapshot writes last never roll D1 back", async () => {
  const b = setup();
  const claude = (tokens: number, collectedAt: number): CodingUsageAgent => ({
    id: "claude", state: "ok", collectedAt, error: null, warning: null, sessionCount: 1,
    days: [usageDay("2026-09-28", tokens, [["claude-fable", tokens]])],
  });
  const delta = (tokens: number): CodingBucketDelta => ({ at: T0, id: "claude", model: "claude-fable", inputTokens: tokens, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 });
  const coding = (snapshot: Awaited<ReturnType<typeof b.state.readPulseArchive>>) =>
    snapshot.streams.filter((stream) => stream.stream === "coding-usage" || stream.stream === "coding-buckets");
  const apply = async (snapshot: Awaited<ReturnType<typeof b.state.readPulseArchive>>) => {
    for (const stream of coding(snapshot)) {
      const built = archiveStatements(b.db, stream, snapshot.now);
      await b.db.batch(built.statements);
      await b.state.confirmPulseArchive(stream.stream, built.watermark);
    }
  };
  await storeLedgers(b, "agents-otlp", [claude(50, T0)], T0, { derived: true });
  await storeOtlpBuckets(b, [delta(50)], T0);
  b.at(T0 + M);
  const older = await b.state.readPulseArchive();
  await storeLedgers(b, "agents-otlp", [claude(150, T0 + M)], T0 + M, { derived: true });
  await storeOtlpBuckets(b, [delta(100)], T0 + M);
  b.at(T0 + 2 * M);
  const newer = await b.state.readPulseArchive();
  await apply(newer);
  await apply(older);
  assert.deepEqual(b.all("SELECT total_tokens, revision FROM coding_usage_days WHERE source = 'agents-otlp'"), [{ total_tokens: 150, revision: 2 }]);
  assert.deepEqual(b.all("SELECT tokens, revision FROM coding_usage_models WHERE source = 'agents-otlp'"), [{ tokens: 150, revision: 2 }]);
  assert.deepEqual(b.all("SELECT input_tokens, revision FROM coding_usage_buckets WHERE source = 'agents-otlp'"), [{ input_tokens: 150, revision: 2 }]);
  assert.equal(b.watermark("coding-usage"), "2");
  assert.equal(b.watermark("coding-buckets"), "2");
});

test("pulse archive: migration 0008 carries the frozen Mac buckets and active seconds over", () => {
  const d1 = new DatabaseSync(":memory:");
  const migrations = `${dirname(fileURLToPath(import.meta.url))}/../migrations/`;
  const files = readdirSync(migrations).filter((name) => name.endsWith(".sql")).sort();
  for (const file of files.filter((name) => name < "0008")) d1.exec(readFileSync(`${migrations}${file}`, "utf8"));
  d1.exec(`INSERT INTO coding_token_buckets VALUES (${T0}, 'claude', 'claude-opus', 1, 2, 3, 4, 0, 5)`);
  d1.exec("INSERT INTO agent_usage_days(date, agent, model, total_tokens, active_seconds) VALUES ('2026-09-28', 'claude', '*', 10, 120), ('2026-09-28', 'codex', '*', 5, NULL)");
  for (const file of files.filter((name) => name >= "0008")) d1.exec(readFileSync(`${migrations}${file}`, "utf8"));
  assert.deepEqual(d1.prepare("SELECT bucket_at, source, agent, input_tokens, event_count FROM coding_usage_buckets").all().map((row) => ({ ...row })), [
    { bucket_at: T0, source: "mac", agent: "claude", input_tokens: 1, event_count: 5 },
  ]);
  assert.deepEqual(d1.prepare("SELECT date, agent, model, active_seconds FROM coding_active_days").all().map((row) => ({ ...row })), [
    { date: "2026-09-28", agent: "claude", model: "*", active_seconds: 120 },
  ]);
});

test("pulse archive: a charging session longer than the lookback stays one row across runs", async () => {
  const b = setup();
  const start = T0 - 3 * 24 * 60 * M;
  const rows = [JSON.stringify({ t: start - M, watts: 0 })];
  for (let t = start; t <= T0; t += M) rows.push(JSON.stringify({ t, watts: 20 }));
  await b.storage.batch().append(pulseChargingKey(), ...rows).execute();
  for (let run = 0; run < 4; run++) {
    const at = T0 + (run + 1) * M;
    await b.storage.batch().append(pulseChargingKey(), JSON.stringify({ t: at, watts: 20 })).execute();
    b.at(at);
    await b.archive().run();
  }
  assert.deepEqual(b.all("SELECT started_at FROM charging_sessions"), [{ started_at: start }]);
});

test("pulse archive: watching idle after an explicit stop outlives the seven-day TTL", async () => {
  const b = setup();
  await b.write(() => recordStateObservation("watching", T0, { state: "idle", itemId: null, title: null, subtitle: null }));
  b.at(T0 + 8 * 24 * 60 * M);
  const raw = await b.storage.get(pulseLaneOpenKey("watching"));
  assert.equal(JSON.parse(raw!).holdUntil, null);
  await b.write(() => recordStateObservation("listening", T0, music("Helpless")));
  b.at(T0 + 16 * 24 * 60 * M);
  assert.equal(await b.storage.get(pulseLaneOpenKey("listening")), null, "a finite hold still expires with the TTL");
  assert.ok(await b.storage.get(pulseLaneOpenKey("watching")));
});

test("pulse archive: active seconds split at the site midnight", () => {
  const midnight = Date.UTC(2026, 8, 28, 16, 0, 0);
  const rows = activeSecondsByDay([{ t: midnight - M, available: true, desktop: null, agents: [{ id: "claude", model: "m", active: true }] }], [], midnight - 2 * M, midnight + 10 * M);
  assert.deepEqual(rows.filter((row) => row.model === "m").map((row) => [row.date, row.seconds]), [["2026-09-28", 60], ["2026-09-29", 120]]);
  assert.equal(siteDate(midnight), "2026-09-29");
});

test("pulse archive: one stream failure does not block the others and keeps its watermark", async () => {
  const b = setup({ failStream: "gaming" });
  await b.write(async () => {
    await recordStateObservation("gaming", T0, { state: "in-game", titleId: "PPSA01", title: "Pragmata" });
    await recordStateObservation("gaming", T0 + 5 * M, { state: "offline", titleId: null, title: null });
    await recordStateObservation("listening", T0, music("Helpless"));
    await recordStateObservation("listening", T0 + 5 * M, music("Satisfied"));
  });
  await b.archive().run();
  assert.deepEqual(b.logged, ["gaming: D1 unavailable"]);
  assert.equal(b.watermark("gaming"), null);
  assert.equal(b.all("SELECT COUNT(*) AS n FROM listening_plays")[0].n, 1);
});

test("pulse archive: late confirmations advance by max and never move backward", async () => {
  const b = setup();
  assert.equal(await b.state.confirmPulseArchive("charging", T0 + 10), T0 + 10);
  assert.equal(await b.state.confirmPulseArchive("charging", T0), T0 + 10);
  await assert.rejects(() => b.state.confirmPulseArchive("charging", T0, "token"), /Invalid/);
});
