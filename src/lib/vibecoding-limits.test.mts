import assert from "node:assert/strict";
import test from "node:test";

import { attachAgentLimits, mergeAgentLimits } from "./vibecoding-limits.ts";

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
  assert.equal(first.pushedAt, 1_000);
  assert.equal(first.agents.claude?.pushedAt, 1_000);

  const second = mergeAgentLimits(
    first,
    {
      collectedAt: "2026-09-05T12:10:00.000Z",
      // 这一轮 Claude 取失败了：空 limits 加原因，不把上一轮的窗口留着当新的
      agents: [{ id: "claude", plan: null, limits: [], limitsError: "token expired" }],
    },
    2_000,
  );
  assert.equal(second.pushedAt, 2_000);
  assert.deepEqual(second.agents.claude, {
    plan: null,
    limits: [],
    limitsError: "token expired",
    pushedAt: 2_000,
  });
  // codex 这封没提，原样保留，包括它自己的收到时刻
  assert.equal(second.agents.codex?.pushedAt, 1_000);
  assert.equal(second.agents.codex?.limitsError, "过期");
  // 不改动传进来的上一份
  assert.equal(first.agents.claude?.limits.length, 1);
});

test("按 id 贴回用量行：用量里没有的 id 不产生新行，没上报过限额的行按「没配」", () => {
  const usage = [
    { id: "claude", label: "Claude Code" },
    { id: "cursor", label: "Cursor" },
  ];
  const attached = attachAgentLimits(usage as never, {
    pushedAt: 5_000,
    agents: {
      claude: { plan: { tier: "max", label: "Max 5x" }, limits: [window], limitsError: null, pushedAt: 4_000 },
      grok: { plan: null, limits: [window], limitsError: null, pushedAt: 5_000 },
    },
  });
  assert.deepEqual(attached.map((row) => row.id), ["claude", "cursor"]);
  assert.equal(attached[0]?.limitsAt, 4_000);
  assert.equal(attached[0]?.limits.length, 1);
  assert.deepEqual(
    { plan: attached[1]?.plan, limits: attached[1]?.limits, limitsError: attached[1]?.limitsError, limitsAt: attached[1]?.limitsAt },
    { plan: null, limits: [], limitsError: null, limitsAt: null },
  );
  // 镜像还没有时也一样
  assert.equal(attachAgentLimits(usage as never, null)[0]?.limitsAt, null);
});
