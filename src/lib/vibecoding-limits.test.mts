import assert from "node:assert/strict";
import test from "node:test";

import { agentLimitsLayoutKey, agentLimitsOf, mergeAgentLimits } from "./vibecoding-limits.ts";

const window = {
  key: "claude.primary",
  label: null,
  group: null,
  windowMinutes: 300,
  usedPercent: 40,
  resetsAt: 1_800_000_000,
};

test("一封只带来的行整行替换，没出现的 id 留着上一次的", () => {
  const first = mergeAgentLimits(
    null,
    {
      collectedAt: "2026-09-05T12:00:00.000Z",
      agents: [
        { id: "claude", plan: { tier: "max", label: "Max 5x" }, limits: [window], limitsError: null },
        { id: "codex", plan: null, limits: [], limitsError: "过期" },
      ],
    },
    1_000,
  );
  assert.equal(first.agents.claude?.updatedAt, 1_000);

  const second = mergeAgentLimits(
    first,
    {
      collectedAt: "2026-09-05T12:10:00.000Z",
      // 这一轮 Claude 取失败了：空 limits 加原因，不把上一轮的窗口留着当新的
      agents: [{ id: "claude", plan: null, limits: [], limitsError: "token expired" }],
    },
    2_000,
  );
  assert.deepEqual(second.agents.claude, {
    plan: null,
    limits: [],
    limitsError: "token expired",
    updatedAt: 2_000,
  });
  // codex 这封没提，原样保留，包括它自己的收到时刻
  assert.equal(second.agents.codex?.updatedAt, 1_000);
  assert.equal(second.agents.codex?.limitsError, "过期");
  // 不改动传进来的上一份
  assert.equal(first.agents.claude?.limits.length, 1);
});

test("按 id 取限额：取到的带上收到时刻，没上报过或这份还没到按「没配」", () => {
  const stored = {
    agents: {
      claude: { plan: { tier: "max", label: "Max 5x" }, limits: [window], limitsError: null, updatedAt: 4_000 },
    },
  };
  assert.deepEqual(agentLimitsOf(stored, "claude"), {
    plan: { tier: "max", label: "Max 5x" },
    limits: [window],
    limitsError: null,
    limitsAt: 4_000,
  });
  const none = { plan: null, limits: [], limitsError: null, limitsAt: null };
  assert.deepEqual(agentLimitsOf(stored, "cursor"), none);
  assert.deepEqual(agentLimitsOf(null, "claude"), none);
  // 原型链上的名字不是 agent
  assert.deepEqual(agentLimitsOf(stored, "constructor"), none);
});

test("布局键只看来源集合，读数变了不算布局变化", () => {
  const row = { plan: null, limits: [window], limitsError: null, updatedAt: 1 };
  const a = agentLimitsLayoutKey({ agents: { codex: row, claude: row } });
  assert.equal(a, agentLimitsLayoutKey({ agents: { claude: { ...row, updatedAt: 9 }, codex: row } }));
  assert.notEqual(a, agentLimitsLayoutKey({ agents: { claude: row } }));
  assert.equal(agentLimitsLayoutKey(null), "[]");
});
