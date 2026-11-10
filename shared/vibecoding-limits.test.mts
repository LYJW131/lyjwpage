import assert from "node:assert/strict";
import test from "node:test";

import { agentLimitsLayoutKey, agentLimitsOf, detectResetCardUse, mergeAgentLimits } from "./vibecoding-limits.ts";

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
        { id: "claude", plan: { tier: "max", label: "Max" }, limits: [window], limitsError: null, authRefreshExpiresAt: 9_000 },
        { id: "codex", plan: null, limits: [], limitsError: "过期", authRefreshExpiresAt: null },
      ],
    },
    1_000,
  );
  assert.equal(first.agents.claude?.updatedAt, 1_000);
  assert.equal(first.agents.claude?.authRefreshExpiresAt, 9_000);
  assert.equal(Object.hasOwn(first.agents.codex ?? {}, "authRefreshExpiresAt"), false);

  const second = mergeAgentLimits(
    first,
    {
      collectedAt: "2026-09-05T12:10:00.000Z",
      agents: [{ id: "claude", plan: null, limits: [], limitsError: "token expired", authRefreshExpiresAt: null }],
    },
    2_000,
  );
  assert.deepEqual(second.agents.claude, {
    plan: null,
    limits: [],
    limitsError: "token expired",
    updatedAt: 2_000,
  });
  assert.equal(second.agents.codex?.updatedAt, 1_000);
  assert.equal(second.agents.codex?.limitsError, "过期");
  assert.equal(first.agents.claude?.limits.length, 1);
});

test("按 id 取限额：取到的带上收到时刻，没上报过或这份还没到按「没配」", () => {
  const stored = {
    agents: {
      claude: { plan: { tier: "max", label: "Max" }, limits: [window], limitsError: null, authRefreshExpiresAt: 9_000, updatedAt: 4_000 },
    },
  };
  assert.deepEqual(agentLimitsOf(stored, "claude"), {
    plan: { tier: "max", label: "Max" },
    limits: [window],
    limitsError: null,
    authRefreshExpiresAt: 9_000,
    limitsAt: 4_000,
  });
  const none = { plan: null, limits: [], limitsError: null, authRefreshExpiresAt: null, limitsAt: null };
  assert.deepEqual(agentLimitsOf(stored, "cursor"), none);
  assert.deepEqual(agentLimitsOf(null, "claude"), none);
  assert.deepEqual(agentLimitsOf(stored, "constructor"), none);
});

test("布局键只看来源集合，读数变了不算布局变化", () => {
  const row = { plan: null, limits: [window], limitsError: null, updatedAt: 1 };
  const a = agentLimitsLayoutKey({ agents: { codex: row, claude: row } });
  assert.equal(a, agentLimitsLayoutKey({ agents: { claude: { ...row, updatedAt: 9 }, codex: row } }));
  assert.notEqual(a, agentLimitsLayoutKey({ agents: { claude: row } }));
  assert.equal(agentLimitsLayoutKey(null), "[]");
});

test("用卡判据：同一窗口里读数往下掉就是用卡，不看两封之间用得多快，卡前全是 Fable 用量时两种都返回", () => {
  const at = 1_800_000_000_000;
  const resetsAt = at / 1000 + 3 * 86_400;
  const row = (weekly: number, fable: number) => ({
    plan: null,
    limitsError: null,
    updatedAt: at,
    limits: [
      { key: "weekly_all", label: null, group: null, windowMinutes: 10080, usedPercent: weekly, resetsAt },
      { key: "claude-weekly-scoped-fable", label: "Fable only", group: null, windowMinutes: 10080, usedPercent: fable, resetsAt },
    ],
  });
  assert.deepEqual(detectResetCardUse(row(20, 40), row(0, 0), at), ["fable", "standard"], "全是 Fable 用量，两种卡都说得通");
  assert.deepEqual(detectResetCardUse(row(80, 99), row(32, 2), at), ["fable"], "卡后马上又用了一点");
  assert.deepEqual(detectResetCardUse(row(80, 40), row(3, 2), at), ["standard"], "周卡后马上又用了一点");
  assert.deepEqual(detectResetCardUse(row(80, 99), row(60, 30), at), ["fable"], "卡后到下一封之间用掉很多也认得出");
  assert.deepEqual(detectResetCardUse(row(80, 40), row(45, 30), at), ["standard"], "比 Fable 卡能退到的还低");
  assert.deepEqual(detectResetCardUse(row(41, 33), row(25, 0), at), ["fable"]);
  assert.deepEqual(detectResetCardUse(row(60, 40), row(0, 0), at), ["standard"]);
  assert.deepEqual(detectResetCardUse(row(3, 2), row(0, 0), at), ["fable", "standard"], "用得少也认得出");
  assert.deepEqual(detectResetCardUse(row(41, 33), row(40, 33), at), [], "差 1 是取整");
  assert.deepEqual(detectResetCardUse(row(41, 33), row(42, 34), at), []);
  assert.deepEqual(detectResetCardUse(undefined, row(0, 0), at), []);
});
