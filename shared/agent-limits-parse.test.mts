import assert from "node:assert/strict";
import test from "node:test";

import { normalizeAgentLimits } from "./agent-limits-parse.ts";

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
