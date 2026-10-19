import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { codingObservationsKey, cursorObservationsKey } from "./coding-pulse";
import type { CodingBucketDelta } from "@shared/coding-buckets";
import type { CodingTokenBucketReport, CodingUsageAgent, CodingUsageDay } from "@shared/coding-usage";
import type { CodingUsageSource } from "@shared/coding-usage-sources";
import { prepareCodingBuckets, prepareOtlpBuckets } from "./stores/coding-buckets.ts";
import { prepareCodingUsage } from "./stores/coding-usage.ts";
import { activeSecondsByDay, archiveStatements, siteDate } from "./pulse-archive.ts";
import { M, T0, setup } from "./testing/pulse-archive-harness";

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
  await b.write(async () => (await prepareOtlpBuckets("agents-otlp", deltas, at)).commit());
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

test("pulse archive: active seconds split at the site midnight", () => {
  const midnight = Date.UTC(2026, 8, 28, 16, 0, 0);
  const rows = activeSecondsByDay([{ t: midnight - M, available: true, desktop: null, agents: [{ id: "claude", model: "m", active: true }] }], [], midnight - 2 * M, midnight + 10 * M);
  assert.deepEqual(rows.filter((row) => row.model === "m").map((row) => [row.date, row.seconds]), [["2026-09-28", 60], ["2026-09-29", 120]]);
  assert.equal(siteDate(midnight), "2026-09-29");
});
