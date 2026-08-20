import assert from "node:assert/strict";
import test from "node:test";

import {
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
    plan: null,
    limits: [],
    limitsError: null,
    ...extra,
  };
}

const FIVE = ["claude", "codex", "cursor", "grok", "antigravity"];

test("五个来源同一形状就能收，不靠 quotaProviders", () => {
  const parsed = normalizeVibeCodingUsage({
    agents: FIVE.map((id) => agent(id, {
      label: id === "claude" ? "Claude Code" : id,
      icon: id === "claude" ? "anthropic" : id,
      limits: id === "cursor"
        ? [{ key: "cursor.primary", usedPercent: 41, resetsAt: 1_800_000_000 }]
        : [],
    })),
    totals: totals(),
    topModels: [{ model: "claude-opus-4", tokens: 12 }],
    collectedAt: "2026-04-08T12:00:00.000Z",
    quotaProviders: [{ id: "stale", label: "Stale", icon: "stale" }],
  });
  assert.ok(parsed);
  assert.deepEqual(parsed.agents.map((row) => row.id), FIVE);
  assert.equal(parsed.agents[0]?.label, "Claude Code");
  assert.equal(parsed.agents[2]?.limits[0]?.usedPercent, 41);
  assert.equal("quotaProviders" in parsed, false);
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
