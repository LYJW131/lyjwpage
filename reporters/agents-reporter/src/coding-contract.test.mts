import assert from "node:assert/strict";
import test from "node:test";

await import("../../../src/lib/testing/register-alias.mjs");
const contract = await import("../../../shared/coding-usage.ts");
const codingModels = await import("../../../shared/coding-models.ts");
const ingest = await import("../../../shared/ingest/agents.ts");

const { bucketStart, MAX_DAY_MODELS, MAX_WINDOW_ROWS, OVERFLOW_MODEL } = await import("../dist/coding-usage.js");
const { recentPayload, recentReports } = await import("../dist/cursor-now.js");
const {
  aggregateEvents,
  applyIncrementalLedger,
  applyLedger,
  cursorActivityReport,
  cursorBucketReport,
  failedUsage,
  latestOf,
  parseRecentPage,
  parseUsagePage,
} = await import("../dist/cursor-usage.js");

const NOW = Date.parse("2026-09-29T04:12:30Z");

function eventRow(offsetMs: number, model: string, tokens: number | null) {
  return {
    timestamp: String(NOW + offsetMs),
    model,
    ...(tokens == null
      ? { isTokenBasedCall: false }
      : {
          tokenUsage: { inputTokens: tokens, outputTokens: 2, cacheReadTokens: 30, cacheWriteTokens: 4, totalCents: 12 },
          chargedCents: 3,
          isTokenBasedCall: true,
        }),
  };
}

const DAY = 86_400_000;

const rows = [
  eventRow(-2 * DAY - 3_600_000, "claude-sonnet-4-5", 1_000),
  eventRow(-DAY, "gpt-5", 2_000),
  eventRow(-DAY + 60_000, "composer-2", 500),
  eventRow(-3_600_000, "gpt-5", 3_000),
  eventRow(-1_200_000, "composer-2", null),
  eventRow(-100_000, "claude-sonnet-4-5", 4_000),
  eventRow(-30_000, "gpt-5", 5_000),
];
const events = parseUsagePage(
  { totalUsageEventsCount: rows.length, usageEventsDisplay: rows },
  0,
  NOW,
).events;

const RECENT_FROM = bucketStart(NOW - 15 * 60_000);
const recentPage = () =>
  parseRecentPage(
    {
      totalUsageEventsCount: 4,
      usageEventsDisplay: [
        eventRow(-600_000, "gpt-5", 100),
        eventRow(-200_000, "composer-2", 50),
        { timestamp: String(NOW - 40_000), model: "github_bugbot" },
        eventRow(20_000, "gpt-5", 7),
      ],
    },
    RECENT_FROM,
    NOW + 5 * 60_000,
  );

const wire = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

test("codingUsage：全量那一轮和增量那一轮的账本都过站点校验，收下的和发出的一模一样", () => {
  const aggregated = aggregateEvents(events, NOW);
  const collectedAt = new Date(NOW).toISOString();
  const full = applyLedger(null, "account", aggregated.days, collectedAt, aggregated.unmeasured);
  const sent = wire({ agents: [full.usage] });
  assert.deepEqual(contract.normalizeCodingUsageReport(sent, NOW), sent);
  assert.ok((sent.agents[0]?.days?.length ?? 0) >= 3);

  const incremental = applyIncrementalLedger(full.ledger, aggregateEvents(events.slice(-2), NOW + 60_000).days, new Date(NOW + 60_000).toISOString());
  const next = wire({ agents: [incremental.usage] });
  assert.deepEqual(contract.normalizeCodingUsageReport(next, NOW + 60_000), next);
});

test("codingUsage：拉失败只带 error 状态（有账本 / 从没成功过）都过站点校验", () => {
  for (const lastCollectedAt of ["2026-09-29T01:00:00.000Z", null]) {
    const sent = wire({ agents: [failedUsage(new Error("Cursor session expired"), lastCollectedAt)] });
    const normalized = contract.normalizeCodingUsageReport(sent, NOW);
    assert.deepEqual(normalized, sent);
    assert.equal("days" in (normalized.agents[0] ?? {}), false);
  }
});

test("codingActivity：有事件、没有事件（时刻为 null）都过站点校验", () => {
  const seen = wire(cursorActivityReport(NOW, latestOf([{ at: NOW - 30_000, model: "gpt-5" }])));
  assert.deepEqual(contract.normalizeCodingActivityReport(seen, NOW), seen);
  const none = wire(cursorActivityReport(NOW, null));
  assert.deepEqual(contract.normalizeCodingActivityReport(none, NOW), none);
});

test("codingTokenBuckets：限额那一轮的滚动一天范围过站点校验，桶起点对齐、行不越界", () => {
  const from = bucketStart(NOW - 24 * 3_600_000);
  const sent = wire(cursorBucketReport(events, { from, to: NOW }, NOW));
  const normalized = contract.normalizeCodingTokenBucketReport(sent, NOW);
  assert.deepEqual(normalized, sent);
  assert.ok(normalized.windows.length >= 3);
  assert.ok(normalized.windows.every((window) => window.agents.every((entry) => entry.eventCount != null && entry.eventCount >= 1)));
});

test("codingTokenBuckets：快循环的 partial 报告和窗口里没有事件的空报告都过站点校验", () => {
  const partial = recentReports(recentPage().events, RECENT_FROM, NOW);
  const sentBuckets = wire(partial.buckets);
  assert.deepEqual(contract.normalizeCodingTokenBucketReport(sentBuckets, NOW), sentBuckets);
  assert.deepEqual(sentBuckets.agents, [{ id: "cursor", state: "partial" }]);
  const sentActivity = wire(partial.activity);
  assert.deepEqual(contract.normalizeCodingActivityReport(sentActivity, NOW), sentActivity);

  const idle = recentReports(parseRecentPage({}, RECENT_FROM, NOW).events, RECENT_FROM, NOW);
  const sentIdle = wire(idle.buckets);
  assert.deepEqual(contract.normalizeCodingTokenBucketReport(sentIdle, NOW), sentIdle);
  assert.deepEqual(sentIdle.windows, []);
});

test("整封 /api/ingest/agents 信封：限额那一轮（三份都带）和快循环的小信封（不带限额）站点都全收、没有拒收", () => {
  const aggregated = aggregateEvents(events, NOW);
  const { usage } = applyLedger(null, "account", aggregated.days, new Date(NOW).toISOString(), aggregated.unmeasured);
  const latest = latestOf(events.map((event: { timestampMs: number; model: string }) => ({ at: event.timestampMs, model: event.model })));
  const limitsRound = wire({
    collectedAt: new Date(NOW).toISOString(),
    agents: [{ id: "cursor", plan: null, limits: [], limitsError: null }],
    codingUsage: { agents: [usage] },
    codingActivity: cursorActivityReport(NOW, latest),
    codingTokenBuckets: cursorBucketReport(events, { from: bucketStart(NOW - 24 * 3_600_000), to: NOW }, NOW),
    reporter: { commit: null, pushes: 1, rttMs: null, start: NOW - 60_000, end: NOW },
  });
  const prepared = ingest.prepareAgentLimits(limitsRound, NOW);
  assert.deepEqual(prepared.rejected, []);
  assert.ok(prepared.codingUsage && prepared.codingActivity && prepared.codingTokenBuckets);
  assert.equal(prepared.limits?.agents.length, 1);

  const fast = recentReports(recentPage().events, RECENT_FROM, NOW);
  const miniature = wire({
    ...recentPayload(fast, new Date(NOW)),
    reporter: { commit: null, pushes: 2, rttMs: 120, start: NOW - 60_000, end: NOW },
  });
  assert.deepEqual(Object.keys(miniature).sort(), ["codingActivity", "codingTokenBuckets", "collectedAt", "reporter"]);
  const small = ingest.prepareAgentLimits(miniature, NOW);
  assert.deepEqual(small.rejected, []);
  assert.equal(small.limits, null);
  assert.ok(small.codingActivity && small.codingTokenBuckets);
});

test("校验确实在跑：少一列、桶起点没对齐、用量行带了 error 状态的 days，站点都会拒", () => {
  const aggregated = aggregateEvents(events, NOW);
  const { usage } = applyLedger(null, "account", aggregated.days, new Date(NOW).toISOString(), aggregated.unmeasured);
  const sent = wire({ agents: [usage] });

  const missing = wire(sent);
  delete (missing.agents[0]?.days?.[0] as Partial<{ reasoningTokens: number }>).reasoningTokens;
  assert.throws(() => contract.normalizeCodingUsageReport(missing, NOW), /reasoningTokens/);

  const errorWithDays = wire(sent);
  (errorWithDays.agents[0] as { state: string }).state = "error";
  assert.throws(() => contract.normalizeCodingUsageReport(errorWithDays, NOW), /state 为 error 时必须缺省/);

  const buckets = wire(cursorBucketReport(events, { from: bucketStart(NOW - 24 * 3_600_000), to: NOW }, NOW));
  buckets.windows[0]!.from += 1;
  assert.throws(() => contract.normalizeCodingTokenBucketReport(buckets, NOW), /对齐 5 分钟/);
});

function crowdedEvents(count: number) {
  const start = bucketStart(NOW - 3_600_000);
  const crowded = Array.from({ length: count }, (_, index) =>
    eventRow(start + index * 1_000 - NOW, `model-${String(index).padStart(3, "0")}`, 10_000 - index * 10),
  );
  return parseUsagePage({ totalUsageEventsCount: count, usageEventsDisplay: crowded }, 0, NOW).events;
}

const sumOf = <Item,>(items: Item[], pick: (item: Item) => number) => items.reduce((sum, item) => sum + pick(item), 0);
const RANGE = { from: bucketStart(NOW - 24 * 3_600_000), to: NOW };

test("codingUsage：一天 41 个、恰好上限、超过上限的模型，站点都全收，模型合计仍等于总量", () => {
  for (const count of [41, MAX_DAY_MODELS, MAX_DAY_MODELS + 6]) {
    const aggregated = aggregateEvents(crowdedEvents(count), NOW);
    const { usage } = applyLedger(null, "account", aggregated.days, new Date(NOW).toISOString(), aggregated.unmeasured);
    const sent = wire({ agents: [usage] });
    assert.deepEqual(contract.normalizeCodingUsageReport(sent, NOW), sent, `${count} 个模型`);
    const day = sent.agents[0]?.days?.find((row) => row.totalTokens > 0);
    assert.equal(day?.models.length, Math.min(count, MAX_DAY_MODELS), `${count} 个模型`);
    assert.equal(sumOf(day?.models ?? [], (row) => row.tokens), day?.totalTokens, `${count} 个模型`);
  }
});

test("codingTokenBuckets：一个窗口恰好上限、比上限多一个模型，站点都全收，各列与事件数守恒", () => {
  for (const count of [MAX_WINDOW_ROWS, MAX_WINDOW_ROWS + 1]) {
    const crowded = crowdedEvents(count);
    const sent = wire(cursorBucketReport(crowded, RANGE, NOW));
    assert.deepEqual(contract.normalizeCodingTokenBucketReport(sent, NOW), sent, `${count} 个模型`);
    assert.equal(sent.windows.length, 1);
    const rows = sent.windows[0]?.agents ?? [];
    assert.equal(rows.length, MAX_WINDOW_ROWS, `${count} 个模型`);
    for (const column of ["inputTokens", "outputTokens", "cacheReadTokens", "cacheCreationTokens"] as const) {
      assert.equal(sumOf(rows, (row) => row[column]), sumOf(crowded, (item: Record<string, number>) => item[column] ?? 0), `${count} 个模型 ${column}`);
    }
    assert.equal(sumOf(rows, (row) => row.eventCount ?? 0), count, `${count} 个模型 eventCount`);
  }
});

test("整封 /api/ingest/agents：日行和窗口的模型都超过站点上限，并成一行后整封全收、没有拒收", () => {
  const crowded = crowdedEvents(Math.max(MAX_DAY_MODELS, MAX_WINDOW_ROWS) + 6);
  const aggregated = aggregateEvents(crowded, NOW);
  const { usage } = applyLedger(null, "account", aggregated.days, new Date(NOW).toISOString(), aggregated.unmeasured);
  const envelope = wire({
    collectedAt: new Date(NOW).toISOString(),
    agents: [{ id: "cursor", plan: null, limits: [], limitsError: null }],
    codingUsage: { agents: [usage] },
    codingActivity: cursorActivityReport(NOW, latestOf(crowded.map((item: { timestampMs: number; model: string }) => ({ at: item.timestampMs, model: item.model })))),
    codingTokenBuckets: cursorBucketReport(crowded, RANGE, NOW),
    reporter: { commit: null, pushes: 1, rttMs: null, start: NOW - 60_000, end: NOW },
  });
  const prepared = ingest.prepareAgentLimits(envelope, NOW);
  assert.deepEqual(prepared.rejected, []);
  assert.ok(prepared.codingUsage?.agents[0]?.days?.some((day: { models: { model: string }[] }) => day.models.some((row) => row.model === OVERFLOW_MODEL)));
  assert.ok(prepared.codingTokenBuckets?.windows.some((window: { agents: { model: string | null }[] }) => window.agents.some((row) => row.model === OVERFLOW_MODEL)));
});

test("上限确实是站点卡着的：MAX_DAY_MODELS 与 MAX_WINDOW_ROWS 和站点一致（收得下这么多，多一行就拒）", () => {
  const aggregated = aggregateEvents(events, NOW);
  const { usage } = applyLedger(null, "account", aggregated.days, new Date(NOW).toISOString(), aggregated.unmeasured);
  const usageWith = (count: number) => {
    const sent = wire({ agents: [usage] });
    const day = sent.agents[0]!.days![0]!;
    day.models = Array.from({ length: count }, (_, index) => ({ model: `model-${index}`, tokens: 1 }));
    day.totalTokens += count;
    return sent;
  };
  assert.doesNotThrow(() => contract.normalizeCodingUsageReport(usageWith(MAX_DAY_MODELS), NOW));
  assert.throws(() => contract.normalizeCodingUsageReport(usageWith(MAX_DAY_MODELS + 1), NOW), /models 最多 \d+ 条/);

  const bucketsWith = (count: number) => {
    const sent = wire(cursorBucketReport(events, RANGE, NOW));
    sent.windows[0]!.agents = Array.from({ length: count }, (_, index) => ({
      id: "cursor",
      model: `model-${index}`,
      inputTokens: 1,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      reasoningTokens: 0,
      eventCount: 1,
    }));
    return sent;
  };
  assert.doesNotThrow(() => contract.normalizeCodingTokenBucketReport(bucketsWith(MAX_WINDOW_ROWS), NOW));
  assert.throws(() => contract.normalizeCodingTokenBucketReport(bucketsWith(MAX_WINDOW_ROWS + 1), NOW), /windows\[0\]\.agents 最多 \d+ 条/);
});

test("并出来的占位行名是站点隐藏名单里的名字：视图不当模型名展示、不进排名", () => {
  assert.equal(codingModels.isVisibleCodingModel(OVERFLOW_MODEL), false);
});
