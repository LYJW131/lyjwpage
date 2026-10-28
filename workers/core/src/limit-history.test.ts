import assert from "node:assert/strict";
import test from "node:test";

import type { ParsedAgentLimits } from "@shared/agent-limits-parse";
import { siteDay } from "@shared/history-ingest";
import { backfillLimitHours, getLimitHistory } from "./limit-history";
import { commitPreparedAgentsReport } from "./stores/agents";
import { M, T0, setup } from "./testing/pulse-archive-harness";

const H = 60 * M;
const DAY = 24 * H;

function limits(usedPercent: number, receivedAt: number): ParsedAgentLimits {
  return {
    collectedAt: new Date(receivedAt).toISOString(),
    agents: [
      {
        id: "claude",
        plan: { tier: "max", label: "Max" },
        limits: [{ key: "weekly_all", label: null, group: "weekly", windowMinutes: 10_080, usedPercent, resetsAt: 1_790_000_000 }],
        limitsError: null,
      },
      { id: "codex", plan: null, limits: [], limitsError: "Unavailable" },
    ],
  } as ParsedAgentLimits;
}

type Harness = ReturnType<typeof setup>;

async function report(b: Harness, usedPercent: number, receivedAt: number) {
  b.at(receivedAt);
  await b.write(() => commitPreparedAgentsReport({ source: "agents", receivedAt, limits: limits(usedPercent, receivedAt) } as never));
}

test("limit history: readings land in StateHub per UTC hour and the endpoint reads them back without D1", async () => {
  const b = setup();
  await report(b, 10, T0);
  await report(b, 25, T0 + 10 * M);
  await report(b, 40, T0 + DAY);

  let payload: Awaited<ReturnType<typeof getLimitHistory>> | undefined;
  await b.write(async () => { payload = await getLimitHistory(T0 + DAY + M); });
  const claude = payload?.series.find((series) => series.agent === "claude" && series.key === "weekly_all");
  assert.deepEqual(claude?.points.map(([at, used]) => [at, used]), [[T0 + 10 * M, 25], [T0 + DAY, 40]]);
  assert.deepEqual(b.all("SELECT * FROM limit_hours"), [], "nothing is written to D1 on ingest");
});

test("limit history: the archive cron copies new readings to both D1 tables once and advances the watermark", async () => {
  const b = setup();
  await report(b, 10, T0);
  await report(b, 25, T0 + 10 * M);
  await report(b, 40, T0 + DAY);
  await b.archive().run();
  await b.archive().run();

  assert.deepEqual(b.all("SELECT date, agent, used_percent, plan FROM limit_snapshots ORDER BY date"), [
    { date: siteDay(T0), agent: "claude", used_percent: 25, plan: "max" },
    { date: siteDay(T0 + DAY), agent: "claude", used_percent: 40, plan: "max" },
  ]);
  assert.deepEqual(b.all("SELECT agent, hour_at, used_percent FROM limit_hours ORDER BY hour_at"), [
    { agent: "claude", hour_at: T0, used_percent: 25 },
    { agent: "claude", hour_at: T0 + DAY, used_percent: 40 },
  ]);
  assert.equal(b.watermark("limits"), String(T0 + DAY));
});

test("limit history: the first cron backfills the window from D1 once, and backfilled rows are not archived again", async () => {
  const b = setup();
  b.exec(`INSERT INTO limit_hours(agent, limit_key, hour_at, window_minutes, used_percent, resets_at, received_at)
    VALUES ('claude', 'weekly_all', ${T0 - 2 * H}, 10080, 5, NULL, ${T0 - 2 * H + M}),
           ('claude', 'weekly_all', ${T0 - 30 * DAY}, 10080, 1, NULL, ${T0 - 30 * DAY})`);
  b.exec(`INSERT INTO limit_snapshots(date, agent, limit_key, label, limit_group, window_minutes, used_percent, resets_at, plan, received_at)
    VALUES ('${siteDay(T0 - 3 * DAY)}', 'claude', 'weekly_all', NULL, 'session', 10080, 7, NULL, 'pro', ${T0 - 3 * DAY})`);
  await report(b, 25, T0);
  const d1 = { prepare: (query: string) => ({ bind: (...values: unknown[]) => ({ all: async <T>() => ({ results: b.all(query, values) as T[] }) }) }) };

  let first: number | null = null;
  let second: number | null = 0;
  let payload: Awaited<ReturnType<typeof getLimitHistory>> | undefined;
  await b.write(async () => {
    first = await backfillLimitHours(d1, T0 + M);
    second = await backfillLimitHours(d1, T0 + M);
    payload = await getLimitHistory(T0 + M);
  });
  assert.equal(first, 2, "the in-window hour and day rows come back; the 30-day-old row does not");
  assert.equal(second, null);
  const claude = payload?.series.find((series) => series.agent === "claude" && series.key === "weekly_all");
  assert.deepEqual(claude?.points.map(([, used]) => used), [7, 5, 25]);

  const before = b.changes();
  await b.archive().run();
  assert.equal(b.changes() - before, 2, "only the live reading is written (one row per table)");
});

test("limit history: the backfill also finishes when D1 has nothing in the window", async () => {
  const b = setup();
  const d1 = { prepare: (query: string) => ({ bind: (...values: unknown[]) => ({ all: async <T>() => ({ results: b.all(query, values) as T[] }) }) }) };
  let first: number | null = null;
  let second: number | null = 0;
  await b.write(async () => {
    first = await backfillLimitHours(d1, T0);
    second = await backfillLimitHours(d1, T0);
  });
  assert.equal(first, 0);
  assert.equal(second, null);
});

test("limit history: many series × days stay within one storage batch's command cap on archive and backfill", async () => {
  const b = setup();
  const keys = Array.from({ length: 8 }, (_, i) => `k${i}`);
  const values = keys.flatMap((limitKey) => Array.from({ length: 20 }, (_, day) =>
    `('codex', '${limitKey}', ${T0 - (day + 1) * DAY}, 300, ${day}, NULL, ${T0 - (day + 1) * DAY + M})`));
  b.exec(`INSERT INTO limit_hours(agent, limit_key, hour_at, window_minutes, used_percent, resets_at, received_at) VALUES ${values.join(", ")}`);
  b.at(T0);
  await b.write(() => commitPreparedAgentsReport({
    source: "agents",
    receivedAt: T0,
    limits: {
      collectedAt: new Date(T0).toISOString(),
      agents: [{ id: "codex", plan: null, limitsError: null,
        limits: keys.map((limitKey) => ({ key: limitKey, label: null, group: null, windowMinutes: 300, usedPercent: 50, resetsAt: null })) }],
    } as ParsedAgentLimits,
  } as never));
  await b.archive().run();
  assert.deepEqual(b.logged, []);
  assert.equal(b.all("SELECT COUNT(*) AS n FROM limit_hours WHERE hour_at = ?", [T0])[0]?.n, 8);

  const d1 = { prepare: (query: string) => ({ bind: (...args: unknown[]) => ({ all: async <T>() => ({ results: b.all(query, args) as T[] }) }) }) };
  let filled: number | null = null;
  await b.write(async () => { filled = await backfillLimitHours(d1, T0 + M); });
  assert.equal(filled, 160);
});
