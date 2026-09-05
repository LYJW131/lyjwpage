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
    costComplete: true,
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
    usageStatus: usageStatus(),
    ...extra,
  };
}

function usageStatus(extra: Record<string, unknown> = {}) {
  return {
    state: "ok",
    collectedAt: "2026-04-08T12:00:00.000Z",
    error: null,
    coverageStart: "2026-04-01",
    coverageEnd: "2026-04-08",
    precision: "measured",
    costComplete: true,
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
      { id: "codex", limits: [], limitsError: "Codex：token expired" },
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
  assert.equal(parsed.agents[1]?.limitsError, "Codex：token expired");
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

test("未知用量为 null，成功取得的零用量保持 0，不能互相转换", () => {
  const zeroDay = Object.fromEntries(Object.keys(today()).map((key) => [key, key === "date" ? "2026-04-08" : 0]));
  const parsed = normalizeVibeCodingUsage({
    agents: [
      agent("cursor", {
        today: null,
        usageStatus: usageStatus({ state: "unavailable", collectedAt: null, coverageStart: null, coverageEnd: null, costComplete: false }),
      }),
      agent("claude", { today: zeroDay }),
    ],
    totals: { ...totals(), costComplete: false },
  });
  assert.ok(parsed);
  assert.equal(parsed.agents[0]?.today, null);
  assert.equal(parsed.agents[0]?.usageStatus.collectedAt, null);
  assert.equal(parsed.agents[1]?.today?.totalTokens, 0);
  assert.equal(parsed.totals.costComplete, false);
});

test("同步失败保留缓存用量与上次成功时刻，不把摘要生成时间当成功时间", () => {
  const status = usageStatus({ state: "error", error: "Cursor session expired", costComplete: false, precision: "mixed" });
  const parsed = normalizeVibeCodingUsage({
    agents: [agent("cursor", { usageStatus: status })],
    totals: { ...totals(), costComplete: false },
    collectedAt: "2026-04-09T12:00:00.000Z",
  });
  assert.ok(parsed);
  assert.deepEqual(parsed.agents[0]?.today, today());
  assert.deepEqual(parsed.agents[0]?.usageStatus, status);
  assert.equal(parsed.collectedAt, "2026-04-09T12:00:00.000Z");
  assert.equal(parsed.totals.apiEquivalentCostUSD, 1.2);
});

test("新用量契约要求来源状态、费用完整性和有效日期，旧报文不能假装成功", () => {
  for (const extra of [
    { usageStatus: undefined },
    { usageStatus: usageStatus({ state: "ready" }) },
    { usageStatus: usageStatus({ collectedAt: "invalid" }) },
    { usageStatus: usageStatus({ coverageStart: "2026-02-30" }) },
    { usageStatus: usageStatus({ coverageEnd: "2026-03-01" }) },
    { usageStatus: usageStatus({ precision: "unknown" }) },
    { usageStatus: usageStatus({ costComplete: undefined }) },
    { today: undefined },
    { today: { ...today(), date: "2026-02-30" } },
  ]) {
    assert.equal(normalizeVibeCodingUsage({ agents: [agent("cursor", extra)], totals: totals() }), null);
  }
  assert.equal(normalizeVibeCodingUsage({ agents: [agent("cursor")], totals: { ...totals(), costComplete: undefined } }), null);
});
