import assert from "node:assert/strict";
import test from "node:test";

import {
  extractClaudeProfilePlan,
  formatClaudePlanLabel,
  normalizeClaudeUsage,
  rowFromClaudeUsage,
} from "../../dist/providers/claude.js";
import { claudeWindows } from "../../dist/windows.js";

test("formatClaudePlanLabel 把 rateLimitTier 收成 Max 5x / Max 20x", () => {
  assert.equal(formatClaudePlanLabel("max", "default_claude_max_5x"), "Max 5x");
  assert.equal(formatClaudePlanLabel("max", "default_claude_max_20x"), "Max 20x");
  assert.equal(formatClaudePlanLabel("pro", null), "Pro");
  assert.equal(formatClaudePlanLabel("team", "default_claude_max_5x"), "Team");
});

test("extractClaudeProfilePlan 从 organization.rate_limit_tier 取套餐", () => {
  assert.deepEqual(
    extractClaudeProfilePlan({
      organization: { rate_limit_tier: "default_claude_max_5x", organization_type: "max" },
      account: { has_claude_max: true },
    }),
    { subscriptionType: "max", rateLimitTier: "default_claude_max_5x" },
  );
  assert.equal(extractClaudeProfilePlan({}), null);
});

test("normalizeClaudeUsage 沿用 five_hour / seven_day 并补上 scoped 周窗口", () => {
  const node = normalizeClaudeUsage({
    five_hour: { utilization: 37.5, resets_at: "2026-09-05T17:00:00.000Z" },
    seven_day: { utilization: 12, resets_at: "2026-09-12T00:00:00.000Z" },
    seven_day_opus: { utilization: 5 },
    limits: [
      {
        kind: "weekly_scoped",
        percent: 8,
        scope: { model: { display_name: "Fable" } },
        resets_at: "2026-09-12T00:00:00.000Z",
      },
    ],
  });
  const windows = claudeWindows(node);
  assert.equal(windows[0]?.key, "claude.primary");
  assert.equal(windows[0]?.usedPercent, 37.5);
  assert.equal(windows[0]?.windowMinutes, 300);
  assert.equal(windows[1]?.key, "weekly_all");
  assert.equal(windows[2]?.key, "claude-weekly-scoped-opus");
  assert.equal(windows[2]?.label, "Opus only");
  assert.equal(windows[3]?.key, "claude-weekly-scoped-fable");
  assert.equal(windows[3]?.label, "Fable only");
  assert.equal(windows[3]?.usedPercent, 8);
  assert.equal(windows[2]?.resetsAt, windows[1]?.resetsAt);
});

test("rowFromClaudeUsage 把套餐交给 agentPlanLabel", () => {
  const row = rowFromClaudeUsage(
    {
      five_hour: { utilization: 7, resets_at: "2026-09-05T18:00:00.000Z" },
      seven_day: { utilization: 1, resets_at: "2026-09-12T00:00:00.000Z" },
    },
    { subscriptionType: "max", rateLimitTier: "default_claude_max_5x" },
  );
  assert.deepEqual(row.plan, { tier: "Max 5x", label: "Max 5x" });
  assert.equal(row.limitsError, null);
  assert.equal(row.limits.length, 2);
});
