import assert from "node:assert/strict";
import test from "node:test";

import { agentUsageLabel, agentUsageUrl } from "./agent-usage-url.ts";

test("有官方用量页的 agent 链到该页", () => {
  assert.equal(agentUsageUrl("claude"), "https://claude.ai/settings/usage");
  assert.equal(agentUsageUrl("cursor"), "https://cursor.com/dashboard/spending");
  assert.equal(agentUsageUrl("codex"), "https://chatgpt.com/codex/cloud/settings/analytics#usage");
  assert.equal(agentUsageUrl("grok"), "https://grok.com/?_s=usage");
});

test("Antigravity 没有可链的用量页", () => {
  assert.equal(agentUsageUrl("antigravity"), null);
  assert.equal(agentUsageUrl("opencode"), null);
});

test("无障碍名称用英文显示名", () => {
  assert.equal(agentUsageLabel("Grok Build"), "Grok Build usage");
  assert.equal(agentUsageLabel("Claude Code", "5-hour limit"), "Claude Code usage, 5-hour limit");
});
