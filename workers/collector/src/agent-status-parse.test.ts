import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_STATUS_URLS,
  agentStatusFingerprint,
  collectAgentStatus,
} from "./agent-status-parse.ts";
import type { AgentStatusPayload } from "@shared/agent-status-types.ts";
import { pages, row } from "./testing/agent-status-pages.ts";

test("一家失败时留着上一轮，其它家照常更新", async () => {
  const first = await collectAgentStatus(null, pages(), 1_000);
  const second = await collectAgentStatus(first, pages({
    [AGENT_STATUS_URLS.openai]: new Error("timeout"),
  }), 2_000);
  assert.equal(row(second, "codex").stale, true);
  assert.equal(row(second, "codex").indicator, "partial_outage");
  assert.equal(row(second, "claude").stale, false);
  assert.equal(second.fetchedAt, 2_000);
  assert.equal(agentStatusFingerprint(first) === agentStatusFingerprint({ ...first, fetchedAt: 9_000 }), true);
  assert.equal(agentStatusFingerprint(first), agentStatusFingerprint(second));
});

test("首屏指纹只认 id 与灯色，标题、描述、组件变化不算", async () => {
  const first = await collectAgentStatus(null, pages(), 1_000);
  const retitled: AgentStatusPayload = {
    ...first,
    agents: first.agents.map((agent) => ({
      ...agent,
      note: "changed note",
      components: [],
      incidents: [{ id: "x", title: "new title", status: "investigating", url: "", updatedAt: null, body: "new body" }],
    })),
  };
  assert.equal(agentStatusFingerprint(first), agentStatusFingerprint(retitled));
  const flipped: AgentStatusPayload = {
    ...first,
    agents: first.agents.map((agent) => (agent.id === "claude" ? { ...agent, indicator: "major_outage" as const } : agent)),
  };
  assert.notEqual(agentStatusFingerprint(first), agentStatusFingerprint(flipped));
});

test("九家全失败整轮抛错，不拿沿用的旧行冒充新检查", async (t) => {
  t.mock.method(console, "warn", () => {});
  const previous = await collectAgentStatus(null, pages(), 1_000);
  await assert.rejects(collectAgentStatus(previous, async () => { throw new Error("offline"); }, 61_000));
  const partial = await collectAgentStatus(previous, pages({ [AGENT_STATUS_URLS.apple]: new Error("503") }), 61_000);
  assert.equal(row(partial, "apple").stale, true);
});
