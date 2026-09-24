import assert from "node:assert/strict";
import test from "node:test";

import { mergeCursorUsage, normalizeCursorUsageReport, type ParsedCursorUsage } from "./cursor-usage.ts";
import { sundayOf } from "./github-chart-compact.ts";
import { diffDays } from "./heatmap-window.ts";
import type { ParsedVibeCodingUsage } from "./vibecoding-parse.ts";
import { normalizeVibeCodingYear, YEAR_DAYS } from "./vibecoding-year.ts";

function day(date: string, tokens: number, model = "gpt-5") {
  return {
    date,
    inputTokens: tokens,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: tokens,
    apiEquivalentCostUSD: tokens / 100,
    costComplete: true,
    models: tokens > 0 ? [{ model, tokens }] : [],
  };
}

function usage(cursorToday: number | null, omitted: string[] | null = null): ParsedVibeCodingUsage {
  return {
    agents: [
      {
        id: "claude",
        label: "Claude Code",
        icon: "anthropic",
        models: ["claude-sonnet"],
        currentModel: null,
        topModel: "claude-sonnet",
        today: day("2026-09-05", 300),
        usageStatus: {
          state: "ok",
          collectedAt: "2026-09-05T01:00:00.000Z",
          error: null,
          warning: null,
          coverageStart: "2026-09-01",
          coverageEnd: "2026-09-05",
          precision: "measured",
          costComplete: true,
        },
      },
      {
        id: "cursor",
        label: "Cursor",
        icon: "cursor",
        models: ["gpt-5"],
        currentModel: null,
        topModel: "gpt-5",
        today: cursorToday == null ? null : day("2026-09-05", cursorToday),
        usageStatus: {
          state: "ok",
          collectedAt: "2026-09-05T01:00:00.000Z",
          error: null,
          warning: null,
          coverageStart: "2026-08-01",
          coverageEnd: "2026-09-05",
          precision: "measured",
          costComplete: true,
        },
      },
    ],
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
    topModels: [{ model: "claude-sonnet", tokens: 700 }],
    collectedAt: "2026-09-05T01:00:00.000Z",
    omittedSources: omitted,
  };
}

function cursor(days: ReturnType<typeof day>[]): ParsedCursorUsage {
  return {
    collectedAt: "2026-09-06T02:00:00.000Z",
    state: "ok",
    error: null,
    warning: null,
    coverageStart: days[0]?.date ?? null,
    coverageEnd: days.at(-1)?.date ?? null,
    precision: "measured",
    costComplete: true,
    days,
  };
}

function year(origin: string, marks: Record<string, number>) {
  const days = Array<number>(YEAR_DAYS).fill(0);
  for (const [date, tokens] of Object.entries(marks)) days[diffDays(origin, date)] = tokens;
  return { origin, days, models: [] as string[], mix: [] as number[][], pushedAt: 1 };
}

test("旧 Mac 只补锚定日之后的差额，历史不重复加", () => {
  const origin = sundayOf("2026-09-05");
  const merged = mergeCursorUsage(
    usage(100),
    cursor([day("2026-08-01", 80), day("2026-09-05", 150), day("2026-09-06", 40, "grok-4")]),
    year(origin, { "2026-09-05": 400 }),
    Date.parse("2026-09-06T03:00:00Z"),
  );
  assert.equal(merged.usage.totals.totalTokens, 1_090);
  assert.equal(merged.usage.totals.inputTokens, 1_090);
  assert.equal(merged.usage.totals.apiEquivalentCostUSD, 10.9);
  assert.equal(merged.usage.agents.find((agent) => agent.id === "cursor")?.today?.date, "2026-09-06");
  assert.equal(merged.usage.agents.find((agent) => agent.id === "cursor")?.today?.totalTokens, 40);
  const today = diffDays(origin, "2026-09-05");
  const next = diffDays(origin, "2026-09-06");
  assert.equal(merged.year?.days[today], 450);
  assert.equal(merged.year?.days[next], 40);
  assert.equal(merged.usage.totals.activeDays, 5);
  assert.equal(merged.usage.topModels.find((row) => row.model === "grok-4")?.tokens, 40);
  assert.equal(merged.year?.mix.find((row) => row[0] === next)?.length, 3);
  assert.ok(merged.year && normalizeVibeCodingYear(merged.year));
});

test("Mac 声明省略 Cursor 时，整份日桶加进合计", () => {
  const base = usage(null, ["cursor"]);
  base.agents = base.agents.filter((agent) => agent.id !== "cursor");
  base.totals.totalTokens = 900;
  base.totals.inputTokens = 900;
  const origin = sundayOf("2026-09-05");
  const merged = mergeCursorUsage(
    base,
    cursor([day("2026-09-05", 150), day("2026-09-06", 40)]),
    year(origin, { "2026-09-05": 300 }),
    Date.parse("2026-09-06T03:00:00Z"),
  );
  assert.equal(merged.usage.totals.totalTokens, 1_090);
  assert.equal(merged.usage.agents.find((agent) => agent.id === "cursor")?.today?.date, "2026-09-06");
  assert.equal(merged.usage.agents.find((agent) => agent.id === "cursor")?.today?.totalTokens, 40);
  assert.equal(merged.year?.days[diffDays(origin, "2026-09-05")], 450);
  assert.equal(merged.year?.days[diffDays(origin, "2026-09-06")], 40);
  assert.ok(merged.year && normalizeVibeCodingYear(merged.year));
});

test("当前模型取最近一个有用量的日子里用得最多的那个", () => {
  const base = usage(null, ["cursor"]);
  base.agents = base.agents.filter((agent) => agent.id !== "cursor");
  const busy = day("2026-09-05", 150, "grok-4");
  busy.models = [{ model: "default", tokens: 50 }, { model: "grok-4", tokens: 100 }];
  const merged = mergeCursorUsage(
    base,
    cursor([day("2026-09-04", 900, "claude-opus-5"), busy, day("2026-09-06", 0)]),
    null,
    Date.parse("2026-09-06T03:00:00Z"),
  );
  assert.equal(merged.usage.agents.find((agent) => agent.id === "cursor")?.currentModel, "grok-4");
});

test("容器比 Mac 旧时不回退合计", () => {
  const report = cursor([day("2026-09-05", 1)]);
  report.collectedAt = "2026-09-04T00:00:00.000Z";
  const merged = mergeCursorUsage(usage(100), report, null, Date.parse("2026-09-05T03:00:00Z"));
  assert.equal(merged.usage.totals.totalTokens, 1_000);
  assert.equal(merged.usage.agents.find((agent) => agent.id === "cursor")?.today?.totalTokens, 100);
});

test("坏的 cursorUsage 整份不收", () => {
  assert.equal(normalizeCursorUsageReport({ state: "ok", precision: "measured", costComplete: true, collectedAt: "2026-09-05T00:00:00.000Z", days: [{ date: "2026-09-05" }] }), null);
  const parsed = normalizeCursorUsageReport(cursor([day("2026-09-05", 4)]));
  assert.equal(parsed?.days[0]?.totalTokens, 4);
});
