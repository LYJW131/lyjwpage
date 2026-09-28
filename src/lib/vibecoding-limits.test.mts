import assert from "node:assert/strict";
import test from "node:test";

import { agentLimitsLayoutKey, attachAgentLimits, mergeAgentLimits } from "./vibecoding-limits.ts";

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

test("按 id 合并用量和限额，缺用量的来源仍显示但不伪造零用量", () => {
  const usage = [
    { id: "claude", label: "Claude Code" },
    { id: "cursor", label: "Cursor" },
  ];
  const attached = attachAgentLimits(usage as never, {
    agents: {
      claude: { plan: { tier: "max", label: "Max 5x" }, limits: [window], limitsError: null, updatedAt: 4_000 },
      grok: { plan: null, limits: [window], limitsError: null, updatedAt: 5_000 },
    },
  });
  assert.deepEqual(attached.map((row) => row.id), ["claude", "cursor", "grok"]);
  assert.equal(attached[0]?.limitsAt, 4_000);
  assert.equal(attached[0]?.limits.length, 1);
  assert.deepEqual(
    { plan: attached[1]?.plan, limits: attached[1]?.limits, limitsError: attached[1]?.limitsError, limitsAt: attached[1]?.limitsAt },
    { plan: null, limits: [], limitsError: null, limitsAt: null },
  );
  // 镜像还没有时也一样
  assert.equal(attachAgentLimits(usage as never, null)[0]?.limitsAt, null);
  assert.equal(attached[2]?.label, "Grok Build");
  assert.equal(attached[2]?.today, null);
  assert.equal(attached[2]?.usageStatus.state, "unavailable");
  assert.equal(attached[2]?.limitsAt, 5_000);
});

test("限额先到也能生成来源行，未知来源保留 id 而不丢弃", () => {
  const attached = attachAgentLimits([], {
    agents: {
      cursor: { plan: null, limits: [window], limitsError: null, updatedAt: 5_000 },
      other: { plan: null, limits: [], limitsError: "Unavailable", updatedAt: 5_000 },
    },
  });
  assert.deepEqual(attached.map((row) => row.label), ["Cursor", "other"]);
  assert.ok(attached.every((row) => row.today === null));
  assert.ok(attached.every((row) => row.usageStatus.collectedAt === null));
  assert.equal(attached[1]?.limitsError, "Unavailable");
  assert.deepEqual(attachAgentLimits([], null), []);
});

test("布局键只看来源集合，读数变了不算布局变化", () => {
  const row = { plan: null, limits: [window], limitsError: null, updatedAt: 1 };
  const a = agentLimitsLayoutKey({ agents: { codex: row, claude: row } });
  assert.equal(a, agentLimitsLayoutKey({ agents: { claude: { ...row, updatedAt: 9 }, codex: row } }));
  assert.notEqual(a, agentLimitsLayoutKey({ agents: { claude: row } }));
  assert.equal(agentLimitsLayoutKey(null), "[]");
});
