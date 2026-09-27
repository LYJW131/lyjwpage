import assert from "node:assert/strict";
import test from "node:test";

import { applyOtlpUsage, claudeCloudNow, mergeClaudeCloudUsage, parseOtlpUsage, type ClaudeCloudUsage } from "./claude-cloud-usage.ts";
import { sundayOf } from "./github-chart-compact.ts";
import { diffDays } from "./heatmap-window.ts";
import type { ParsedVibeCodingUsage } from "./vibecoding-parse.ts";
import { normalizeVibeCodingYear, YEAR_DAYS } from "./vibecoding-year.ts";

// 2026-09-25 12:00 上海
const NOW = Date.parse("2026-09-25T04:00:00Z");
const START = "1790285536781000000";

const SESSION = "session-fixture-0001";

/** 照真实 Claude Code 2.1.281 导出的形状：账号字段一个不少（值都是假的） */
function account(extra: Array<[string, string]>) {
  return [
    ["user.id", "user-id-fixture"],
    ["session.id", SESSION],
    ["organization.id", "org-fixture"],
    ["user.email", "someone@example.com"],
    ["user.account_uuid", "account-uuid-fixture"],
    ["user.account_id", "user_01FAKEFAKEFAKE"],
    ["terminal.type", "non-interactive"],
    ...extra,
  ].map(([key, value]) => ({ key, value: { stringValue: value } }));
}

function envelope(
  at: number,
  tokens: { input: number; output: number; cacheRead: number; cacheCreation: number },
  cost: number,
  { temporality = 2, start = START, model = "claude-fable-5-1", source = "main" } = {},
) {
  const time = `${BigInt(at) * BigInt(1_000_000)}`;
  return {
    resourceMetrics: [{
      resource: { attributes: [{ key: "service.name", value: { stringValue: "claude-code" } }] },
      scopeMetrics: [{
        scope: { name: "com.anthropic.claude_code", version: "2.1.281" },
        metrics: [
          {
            name: "claude_code.session.count",
            sum: { aggregationTemporality: temporality, isMonotonic: true, dataPoints: [
              { attributes: account([]), startTimeUnixNano: start, timeUnixNano: time, asDouble: 1 },
            ] },
          },
          {
            name: "claude_code.cost.usage",
            unit: "USD",
            sum: { aggregationTemporality: temporality, isMonotonic: true, dataPoints: [
              { attributes: account([["model", model], ["query_source", source]]), startTimeUnixNano: start, timeUnixNano: time, asDouble: cost },
            ] },
          },
          {
            name: "claude_code.token.usage",
            unit: "tokens",
            sum: {
              aggregationTemporality: temporality,
              isMonotonic: true,
              dataPoints: Object.entries(tokens).map(([type, value]) => ({
                attributes: account([["model", model], ["query_source", source], ["type", type]]),
                startTimeUnixNano: start,
                timeUnixNano: time,
                asDouble: value,
              })),
            },
          },
        ],
      }],
    }],
  };
}

function ingest(previous: ClaudeCloudUsage | null, body: unknown, at: number) {
  return applyOtlpUsage(previous, parseOtlpUsage(body, at), at);
}

test("只收 token 与 cost 两条指标，账号字段不进状态", () => {
  const points = parseOtlpUsage(envelope(NOW, { input: 10, output: 39, cacheRead: 0, cacheCreation: 33_468 }, 0.067141), NOW);
  assert.equal(points.length, 5);
  const { usage } = applyOtlpUsage(null, points, NOW);
  const stored = JSON.stringify(usage);
  for (const secret of ["someone@example.com", "user_01FAKEFAKEFAKE", "account-uuid-fixture", "org-fixture", "user-id-fixture", SESSION]) {
    assert.ok(!stored.includes(secret), `${secret} 不该落库`);
  }
  assert.deepEqual(usage.days, [{
    date: "2026-09-25",
    inputTokens: 10,
    outputTokens: 39,
    cacheReadTokens: 0,
    cacheCreationTokens: 33_468,
    totalTokens: 33_517,
    apiEquivalentCostUSD: 0.067141,
    models: [{ model: "claude-fable-5-1", tokens: 33_517 }],
  }]);
  assert.equal(usage.sessionCount, 1);
});

test("cumulative 只加差值；重发、乱序不多算，丢一轮下一轮补齐", () => {
  let state = ingest(null, envelope(NOW, { input: 10, output: 100, cacheRead: 0, cacheCreation: 0 }, 1), NOW).usage;
  // 同一封重发
  const repeat = ingest(state, envelope(NOW, { input: 10, output: 100, cacheRead: 0, cacheCreation: 0 }, 1), NOW + 1_000);
  assert.equal(repeat.changed, false);
  state = repeat.usage;
  // 中间一轮丢了，下一轮带着全量到达
  state = ingest(state, envelope(NOW + 120_000, { input: 30, output: 300, cacheRead: 0, cacheCreation: 0 }, 3), NOW + 120_000).usage;
  // 丢掉的那一轮迟到了：比记下的小，不回退也不加
  state = ingest(state, envelope(NOW + 60_000, { input: 20, output: 200, cacheRead: 0, cacheCreation: 0 }, 2), NOW + 121_000).usage;
  const [day] = state.days;
  assert.equal(day?.totalTokens, 330);
  assert.equal(day?.apiEquivalentCostUSD, 3);
  assert.equal(state.sessionCount, 1);
});

test("进程起点变了（线程恢复成新进程）按新计数器整份计入", () => {
  let state = ingest(null, envelope(NOW, { input: 100, output: 0, cacheRead: 0, cacheCreation: 0 }, 1), NOW).usage;
  state = ingest(
    state,
    envelope(NOW + 60_000, { input: 40, output: 0, cacheRead: 0, cacheCreation: 0 }, 0.5, { start: "1790285999000000000" }),
    NOW + 60_000,
  ).usage;
  assert.equal(state.days[0]?.inputTokens, 140);
  assert.equal(state.sessionCount, 1);
});

test("主会话和子代理是两条累计序列，都要计入", () => {
  const tokens = { input: 100, output: 0, cacheRead: 0, cacheCreation: 0 };
  let state = ingest(null, envelope(NOW, tokens, 1, { source: "main" }), NOW).usage;
  state = ingest(state, envelope(NOW, { ...tokens, input: 50 }, 0.5, { source: "subagent" }), NOW).usage;
  state = ingest(state, envelope(NOW + 60_000, { ...tokens, input: 120 }, 1.2, { source: "main" }), NOW + 60_000).usage;
  state = ingest(state, envelope(NOW + 60_000, { ...tokens, input: 80 }, 0.8, { source: "subagent" }), NOW + 60_000).usage;
  assert.equal(state.days[0]?.inputTokens, 200);
  assert.equal(state.days[0]?.apiEquivalentCostUSD, 2);
  assert.equal(state.sessionCount, 1);
});

test("delta 时序的点直接相加", () => {
  let state = ingest(null, envelope(NOW, { input: 5, output: 5, cacheRead: 0, cacheCreation: 0 }, 0.1, { temporality: 1 }), NOW).usage;
  state = ingest(state, envelope(NOW + 60_000, { input: 5, output: 5, cacheRead: 0, cacheCreation: 0 }, 0.1, { temporality: 1 }), NOW + 60_000).usage;
  assert.equal(state.days[0]?.totalTokens, 20);
});

test("差值按数据点时刻归到上海日，跨零点分两天", () => {
  const beforeMidnight = Date.parse("2026-09-25T15:59:00Z");
  const afterMidnight = Date.parse("2026-09-25T16:01:00Z");
  let state = ingest(null, envelope(beforeMidnight, { input: 100, output: 0, cacheRead: 0, cacheCreation: 0 }, 1), beforeMidnight).usage;
  state = ingest(state, envelope(afterMidnight, { input: 150, output: 0, cacheRead: 0, cacheCreation: 0 }, 1.5), afterMidnight).usage;
  assert.deepEqual(state.days.map((day) => [day.date, day.inputTokens]), [["2026-09-25", 100], ["2026-09-26", 50]]);
});

test("认不出的封包整封拒；没有用量指标的封包收下但什么都不记", () => {
  assert.throws(() => parseOtlpUsage({ hello: 1 }, NOW));
  assert.deepEqual(parseOtlpUsage({ resourceMetrics: [{ scopeMetrics: [{ metrics: [{ name: "claude_code.active_time.total", sum: {} }] }] }] }, NOW), []);
});

function macUsage(claudeToday: string | null): ParsedVibeCodingUsage {
  const day = (date: string, tokens: number) => ({
    date,
    inputTokens: tokens,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: tokens,
    apiEquivalentCostUSD: tokens / 100,
  });
  return {
    agents: [{
      id: "claude",
      label: "Claude Code",
      icon: "anthropic",
      models: ["claude-opus-5-5"],
      currentModel: null,
      topModel: "claude-opus-5-5",
      today: claudeToday ? day(claudeToday, 300) : null,
      usageStatus: {
        state: "ok",
        collectedAt: "2026-09-25T03:00:00.000Z",
        error: null,
        warning: null,
        coverageStart: "2026-01-01",
        coverageEnd: claudeToday,
        precision: "measured",
        costComplete: true,
      },
    }],
    totals: {
      inputTokens: 1_000,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      reasoningTokens: 0,
      totalTokens: 1_000,
      apiEquivalentCostUSD: 10,
      costComplete: true,
      activeDays: 4,
      sessionCount: 2,
    },
    topModels: [{ model: "claude-opus-5-5", tokens: 700 }],
    collectedAt: "2026-09-25T03:00:00.000Z",
    omittedSources: [],
  };
}

function year(origin: string, marks: Record<string, number>) {
  const days = Array<number>(YEAR_DAYS).fill(0);
  for (const [date, tokens] of Object.entries(marks)) days[diffDays(origin, date)] = tokens;
  return { origin, days, models: [] as string[], mix: [] as number[][], pushedAt: 1 };
}

test("云端日桶整份加进 Mac 合计、Claude 今天和年度图", () => {
  let cloud = ingest(null, envelope(Date.parse("2026-09-24T04:00:00Z"), { input: 50, output: 0, cacheRead: 0, cacheCreation: 0 }, 0.5), NOW).usage;
  cloud = ingest(
    cloud,
    envelope(NOW, { input: 50, output: 0, cacheRead: 0, cacheCreation: 0 }, 0.5, { start: "1790290000000000000" }),
    NOW,
  ).usage;
  const origin = sundayOf("2026-09-25");
  const merged = mergeClaudeCloudUsage(macUsage("2026-09-25"), cloud, year(origin, { "2026-09-25": 300 }), NOW);
  assert.equal(merged.usage.totals.totalTokens, 1_100);
  assert.equal(merged.usage.totals.apiEquivalentCostUSD, 11);
  assert.equal(merged.usage.totals.sessionCount, 3);
  const claude = merged.usage.agents.find((agent) => agent.id === "claude");
  assert.equal(claude?.today?.totalTokens, 350);
  assert.deepEqual(claude?.models, ["claude-opus-5-5", "claude-fable-5-1"]);
  assert.equal(merged.year?.days[diffDays(origin, "2026-09-25")], 350);
  // 24 号只有云端用量：新的活跃日
  assert.equal(merged.year?.days[diffDays(origin, "2026-09-24")], 50);
  assert.equal(merged.usage.totals.activeDays, 5);
  assert.ok(merged.year && normalizeVibeCodingYear(merged.year));
});

test("Mac 那行停在昨天时，今天只算云端的，不加到昨天上", () => {
  const cloud = ingest(null, envelope(NOW, { input: 50, output: 0, cacheRead: 0, cacheCreation: 0 }, 0.5), NOW).usage;
  const merged = mergeClaudeCloudUsage(macUsage("2026-09-24"), cloud, null, NOW);
  const today = merged.usage.agents.find((agent) => agent.id === "claude")?.today;
  assert.equal(today?.date, "2026-09-25");
  assert.equal(today?.totalTokens, 50);
});

test("没有云端用量时原样返回", () => {
  const base = macUsage("2026-09-25");
  assert.equal(mergeClaudeCloudUsage(base, null, null, NOW).usage, base);
});

test("此刻：记下最近有增量的时刻和模型，云端比本机新才换模型", () => {
  let state = ingest(null, envelope(NOW, { input: 10, output: 0, cacheRead: 0, cacheCreation: 0 }, 0.1, { model: "claude-haiku-4-5" }), NOW).usage;
  state = ingest(state, envelope(NOW + 60_000, { input: 10, output: 0, cacheRead: 0, cacheCreation: 0 }, 0.1, { model: "claude-haiku-4-5" }), NOW + 60_000).usage;
  // 值没涨的一轮不推进时刻
  assert.equal(state.lastPointAt, NOW);
  state = ingest(state, envelope(NOW + 120_000, { input: 20, output: 0, cacheRead: 0, cacheCreation: 0 }, 0.2, { model: "claude-fable-5-1", start: "2" }), NOW + 120_000).usage;
  assert.equal(state.lastPointAt, NOW + 120_000);
  assert.equal(state.lastModel, "claude-fable-5-1");

  const olderLocal = { currentModel: "claude-opus-5-5", lastActivityAt: new Date(NOW).toISOString() };
  assert.deepEqual(claudeCloudNow(state, olderLocal), {
    cloudActivityAt: new Date(NOW + 120_000).toISOString(),
    currentModel: "claude-fable-5-1",
  });
  const newerLocal = { currentModel: "claude-opus-5-5", lastActivityAt: new Date(NOW + 180_000).toISOString() };
  assert.equal(claudeCloudNow(state, newerLocal).currentModel, "claude-opus-5-5");
  assert.deepEqual(claudeCloudNow(null, newerLocal), { cloudActivityAt: null, currentModel: "claude-opus-5-5" });
});
