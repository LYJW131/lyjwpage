import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { codingObservationsKey, codingTokenUsageKey, cursorObservationsKey } from "@/lib/coding-pulse";
import { pulseChargingKey, pulseLaneOpenKey, pulseListeningTracesKey } from "@/lib/pulse-keys";
import { installStorageForTests, key, resetStorageForTests } from "@/lib/storage";
import type { HistoryDb } from "@shared/history-ingest";
import { SqliteStore, type SqlDatabase } from "@shared/sqlite-store";
import { StorageClient } from "@shared/storage-client";
import { recordChargingSample, recordStateObservation, replacePulseActivity } from "./stores/pulse.ts";
import { PulseArchive, PulseArchiveState, activeSecondsByDay, archiveStatements, siteDate, type ArchiveStream } from "./pulse-archive.ts";

/** 2026-09-28 10:00 Asia/Shanghai */
const T0 = Date.UTC(2026, 8, 28, 2, 0, 0);
const M = 60_000;

type Statement = { query: string; values: unknown[] };

/**
 * 两个真实 SQLite：一个当 StateHub（SqliteStore + metadata，Pulse 的写入函数直接写它），
 * 一个跑全部 D1 迁移。upsert 的冲突与 WHERE 条件要在引擎里验，不在替身里推断。
 */
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
  const archive = () => new PulseArchive({ coordinator: state, db, log: (stream, error) => logged.push(`${stream}: ${error instanceof Error ? error.message : String(error)}`) });
  return {
    storage, state, archive, logged, db,
    at: (t: number) => { now = t; },
    all: (query: string) => d1.prepare(query).all().map((row) => ({ ...row })) as Record<string, unknown>[],
    changes: () => changes,
    watermark: (stream: ArchiveStream) => (hub.prepare("SELECT value FROM metadata WHERE key = ?").get(`pulse-archive:v2:${stream}`) as { value?: string } | undefined)?.value ?? null,
    /** 以这个 Hub 为存储跑一段写入 */
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
    await b.storage.batch().append(pulseListeningTracesKey(), JSON.stringify({ since: T0 - 4 * M, t: T0 - 2 * M, title: "THE BOOK 3", artist: "YOASOBI", itemId: "1" })).execute();
  });
  b.at(T0 + 10 * M);
  await b.archive().run();
  assert.deepEqual(b.logged, []);
  assert.deepEqual(b.all("SELECT source, started_at, ended_at, certain, title, album, item_id FROM listening_plays ORDER BY started_at"), [
    { source: "recent", started_at: T0 - 4 * M, ended_at: T0 - 2 * M, certain: 0, title: null, album: "THE BOOK 3", item_id: "1" },
    { source: "mac", started_at: T0, ended_at: T0 + 3 * M, certain: 1, title: "Helpless", album: "Hamilton", item_id: null },
    { source: "mac", started_at: T0 + 5 * M, ended_at: T0 + 9 * M, certain: 1, title: "Satisfied", album: "Hamilton", item_id: null },
  ], "paused and idle spans are not plays");
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
    // Emby 在播时最迟 10 分钟再推一次进度
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
    // PSN 没人看时半小时一查：中间那次确认让这一段连成一次
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

test("pulse archive: coding observations, active seconds, token buckets and daily usage per agent and model", async () => {
  const b = setup();
  const observation = (t: number, agents: { id: string; model: string | null; active: boolean }[]) =>
    JSON.stringify({ t, available: true, desktop: { application: "Zed", coding: true }, agents });
  await b.storage.batch()
    .append(codingObservationsKey(),
      observation(T0, [{ id: "claude", model: "claude-opus", active: true }, { id: "codex", model: "gpt", active: false }]),
      observation(T0 + 2 * M, [{ id: "claude", model: "claude-opus", active: true }, { id: "codex", model: "gpt", active: true }]),
      observation(T0 + 4 * M, [{ id: "claude", model: "claude-opus", active: false }]))
    .append(cursorObservationsKey(), JSON.stringify({ t: T0, available: true, lastActivityAt: T0 }))
    .set(codingTokenUsageKey(), JSON.stringify({
      from: T0 - 5 * M, to: T0 + 5 * M, collectedAt: T0 + 6 * M,
      sources: [{ id: "codex", state: "ok" }, { id: "claude", state: "ok" }],
      windows: [{ from: T0, to: T0 + 5 * M, agents: [
        { id: "claude", model: "claude-opus", inputTokens: 10, outputTokens: 20, cacheReadTokens: 30, cacheCreationTokens: 5, reasoningTokens: 0, eventCount: 2 },
        { id: "codex", model: null, inputTokens: 1, outputTokens: 2, cacheReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 1, eventCount: 1 },
      ] }],
    }))
    .set(key("vibecoding", "usage"), JSON.stringify({ pushedAt: T0 + 6 * M, payload: { agents: [
      { id: "claude", today: { date: "2026-09-28", inputTokens: 100, outputTokens: 200, cacheReadTokens: 300, cacheCreationTokens: 50, totalTokens: 650, apiEquivalentCostUSD: 1.25 } },
      { id: "cursor", today: { date: "2026-09-28", inputTokens: 9, outputTokens: 9, cacheReadTokens: 9, cacheCreationTokens: 9, totalTokens: 36, apiEquivalentCostUSD: 9 } },
    ] } }))
    .set(key("vibecoding", "cursor-usage"), JSON.stringify({ pushedAt: T0 + 6 * M, report: { days: [
      { date: "2026-09-28", inputTokens: 5, outputTokens: 6, cacheReadTokens: 7, cacheCreationTokens: 0, totalTokens: 18, apiEquivalentCostUSD: 0.5, costComplete: true, models: [{ model: "composer-1", tokens: 18 }] },
    ] } }))
    .execute();
  b.at(T0 + 7 * M);
  await b.archive().run();
  assert.deepEqual(b.logged, []);
  assert.equal(b.all("SELECT COUNT(*) AS n FROM coding_observations")[0].n, 3);
  assert.deepEqual(b.all("SELECT agent, model, input_tokens, total_tokens, event_count, cost_usd, active_seconds FROM agent_usage_days ORDER BY agent, model"), [
    { agent: "claude", model: "*", input_tokens: 100, total_tokens: 650, event_count: null, cost_usd: 1.25, active_seconds: 240 },
    { agent: "claude", model: "claude-opus", input_tokens: 10, total_tokens: 65, event_count: 2, cost_usd: null, active_seconds: 240 },
    { agent: "codex", model: "", input_tokens: 1, total_tokens: 3, event_count: 1, cost_usd: null, active_seconds: null },
    { agent: "codex", model: "*", input_tokens: null, total_tokens: null, event_count: null, cost_usd: null, active_seconds: 120 },
    { agent: "codex", model: "gpt", input_tokens: null, total_tokens: null, event_count: null, cost_usd: null, active_seconds: 120 },
    { agent: "cursor", model: "*", input_tokens: 5, total_tokens: 18, event_count: null, cost_usd: 0.5, active_seconds: 300 },
    { agent: "cursor", model: "composer-1", input_tokens: null, total_tokens: 18, event_count: null, cost_usd: null, active_seconds: null },
  ], "the Mac's stale Cursor row is ignored; cost exists only per agent");
  const before = b.changes();
  await b.archive().run();
  assert.equal(b.changes(), before, "unchanged sources write nothing");
});

test("pulse archive: a later report's partial first window never overwrites a complete token bucket", async () => {
  const b = setup();
  const agent = (inputTokens: number) => ({ id: "claude", model: "claude-opus", inputTokens, outputTokens: inputTokens, cacheReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0, eventCount: inputTokens });
  const report = (from: number, collectedAt: number, windows: { from: number; count: number }[]) => JSON.stringify({
    from, to: collectedAt, collectedAt, sources: [{ id: "codex", state: "ok" }, { id: "claude", state: "ok" }],
    windows: windows.map((window) => ({ from: window.from, to: window.from + 5 * M, agents: [agent(window.count)] })),
  });
  await b.storage.set(codingTokenUsageKey(), report(T0, T0 + 10 * M, [{ from: T0, count: 30 }, { from: T0 + 5 * M, count: 12 }]));
  await b.archive().run();
  // 下一份报告的范围从 T0+2 分钟起：T0 那个桶只数了后三分钟
  await b.storage.set(codingTokenUsageKey(), report(T0 + 2 * M, T0 + 12 * M, [{ from: T0, count: 4 }, { from: T0 + 5 * M, count: 20 }, { from: T0 + 10 * M, count: 1 }]));
  await b.archive().run();
  assert.deepEqual(b.all("SELECT bucket_at, input_tokens FROM coding_token_buckets ORDER BY bucket_at"), [
    { bucket_at: T0, input_tokens: 30 },
    { bucket_at: T0 + 5 * M, input_tokens: 20 },
    { bucket_at: T0 + 10 * M, input_tokens: 1 },
  ]);
  assert.deepEqual(b.all("SELECT input_tokens FROM agent_usage_days WHERE model = 'claude-opus'"), [{ input_tokens: 51 }]);
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
  const midnight = Date.UTC(2026, 8, 28, 16, 0, 0); // 2026-09-29 00:00 in Shanghai
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
