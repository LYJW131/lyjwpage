import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeAgentLimits,
  normalizeVibeCodingNow,
  normalizeVibeCodingUsage,
} from "./vibecoding-parse.ts";

function today() {
  return {
    date: "2026-04-08",
    inputTokens: 1,
    outputTokens: 2,
    cacheReadTokens: 3,
    cacheCreationTokens: 4,
    totalTokens: 10,
    apiEquivalentCostUSD: 0.1,
  };
}

function totals() {
  return {
    inputTokens: 10,
    outputTokens: 20,
    cacheReadTokens: 30,
    cacheCreationTokens: 40,
    reasoningTokens: 5,
    totalTokens: 100,
    apiEquivalentCostUSD: 1.2,
    activeDays: 3,
    sessionCount: 9,
  };
}

function agent(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    label: id,
    icon: id,
    models: [],
    currentModel: null,
    topModel: null,
    today: today(),
    ...extra,
  };
}

const FIVE = ["claude", "codex", "cursor", "grok", "antigravity"];

test("五个来源同一形状就能收，不靠 quotaProviders", () => {
  const parsed = normalizeVibeCodingUsage({
    agents: FIVE.map((id) => agent(id, {
      label: id === "claude" ? "Claude Code" : id,
      icon: id === "claude" ? "anthropic" : id,
    })),
    totals: totals(),
    topModels: [{ model: "claude-opus-4", tokens: 12 }],
    collectedAt: "2026-04-08T12:00:00.000Z",
    quotaProviders: [{ id: "stale", label: "Stale", icon: "stale" }],
  });
  assert.ok(parsed);
  assert.deepEqual(parsed.agents.map((row) => row.id), FIVE);
  assert.equal(parsed.agents[0]?.label, "Claude Code");
  assert.equal("quotaProviders" in parsed, false);
});

test("用量信封里带的 plan / limits / limitsError 一律不读：限额另有来路", () => {
  const parsed = normalizeVibeCodingUsage({
    agents: [
      agent("claude", {
        label: "Claude Code",
        icon: "anthropic",
        plan: { tier: "max", label: "Max 5x" },
        limits: [{ key: "claude.primary", usedPercent: 41, resetsAt: 1_800_000_000 }],
        limitsError: "过期",
      }),
    ],
    totals: totals(),
  });
  assert.ok(parsed);
  const row = parsed.agents[0] as Record<string, unknown>;
  assert.equal("plan" in row, false);
  assert.equal("limits" in row, false);
  assert.equal("limitsError" in row, false);
});

test("agents 入口：按 id 收行，plan 缺了是 null，坏窗口丢掉、好窗口夹到 0–100", () => {
  const parsed = normalizeAgentLimits({
    collectedAt: "2026-09-05T12:00:00.000Z",
    agents: [
      {
        id: "claude",
        plan: { tier: "max", label: "Max 5x" },
        limits: [
          { key: "claude.primary", usedPercent: 137, windowMinutes: 300, resetsAt: 1_800_000_000 },
          { key: "", usedPercent: 10 },
          { key: "weekly_all", usedPercent: "12" },
        ],
        limitsError: null,
      },
      { id: "codex", limits: [], limitsError: "TokenTracker codex：token expired" },
      { id: "grok", plan: { tier: "" } },
    ],
  });
  assert.ok(parsed);
  assert.equal(parsed.collectedAt, "2026-09-05T12:00:00.000Z");
  assert.deepEqual(parsed.agents.map((row) => row.id), ["claude", "codex", "grok"]);
  assert.deepEqual(parsed.agents[0]?.plan, { tier: "max", label: "Max 5x" });
  assert.deepEqual(parsed.agents[0]?.limits, [
    {
      key: "claude.primary",
      label: null,
      group: null,
      windowMinutes: 300,
      usedPercent: 100,
      resetsAt: 1_800_000_000,
    },
  ]);
  assert.equal(parsed.agents[1]?.limitsError, "TokenTracker codex：token expired");
  assert.deepEqual(parsed.agents[1]?.limits, []);
  // tier 空等于没有套餐信息，不要留一个空标签
  assert.equal(parsed.agents[2]?.plan, null);
  assert.equal(parsed.agents[2]?.limitsError, null);
});

test("agents 入口：没有 id、id 重复、一行都没有，整封不收", () => {
  assert.equal(normalizeAgentLimits({ agents: [] }), null);
  assert.equal(normalizeAgentLimits({ agents: [{ plan: null }] }), null);
  assert.equal(
    normalizeAgentLimits({ agents: [{ id: "claude" }, { id: "claude" }] }),
    null,
  );
  assert.equal(normalizeAgentLimits({ collectedAt: "x" }), null);
});

test("缺展示名或图标的整份不收", () => {
  const agents = FIVE.map((id) => agent(id));
  assert.equal(
    normalizeVibeCodingUsage({
      agents: agents.map((row, index) => (index === 0 ? { ...row, label: "" } : row)),
      totals: totals(),
    }),
    null,
  );
  assert.equal(
    normalizeVibeCodingUsage({
      agents: agents.map((row, index) => (index === 1 ? { ...row, icon: "" } : row)),
      totals: totals(),
    }),
    null,
  );
});

test("id 重复或名单为空都不收", () => {
  assert.equal(
    normalizeVibeCodingUsage({
      agents: [agent("claude"), agent("claude", { label: "Other" })],
      totals: totals(),
    }),
    null,
  );
  assert.equal(normalizeVibeCodingUsage({ agents: [], totals: totals() }), null);
});

test("旧的两行用量、没有 label / icon，不再当合法信封", () => {
  assert.equal(
    normalizeVibeCodingUsage({
      agents: [
        { id: "claude", models: [], today: today() },
        { id: "codex", models: [], today: today() },
      ],
      quotaProviders: [
        { id: "cursor", label: "Cursor", icon: "cursor", usedPercent: 10 },
      ],
      totals: totals(),
    }),
    null,
  );
});

test("vibeCodingNow 按 id 收，不限 claude / codex", () => {
  const parsed = normalizeVibeCodingNow({
    agents: [
      { id: "claude", currentModel: "claude-opus-4", lastActivityAt: "2026-04-08T12:00:00.000Z", active: true },
      { id: "cursor", currentModel: null, lastActivityAt: null, active: false },
      { id: "", currentModel: "skip", active: true },
    ],
  });
  assert.ok(parsed);
  assert.deepEqual(
    parsed.agents.map((row) => row.id),
    ["claude", "cursor"],
  );
  assert.equal(parsed.agents[0]?.active, true);
  assert.equal(parsed.agents[1]?.currentModel, null);
});
