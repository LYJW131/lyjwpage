import assert from "node:assert/strict";
import test from "node:test";
import { CODING_AGENT_CLOUD, CODING_AGENT_CURSOR, CODING_AGENT_MAC, cloudAgentActivity, codingBand } from "@shared/pulse-coding";
import type { StoredCodingBuckets } from "@shared/coding-buckets";
import type { CodingObservation } from "@shared/pulse-coding";
const T = 1_800_000_000_000;
const observation = (t: number, coding = true, agents = true): CodingObservation => ({ t, available: true,
  desktop: { application: coding ? "Zed" : "Safari", coding }, agents: [{ id: "codex", model: "model", active: agents }] });

test("Cursor activity counts as agent work on the band while the Mac is offline", () => {
  const cursor = [{ t: T, available: true, lastActivityAt: T }];
  const band = codingBand([{ ...observation(T), available: false }], cursor, { from: T, to: T + 900_000 });
  assert.deepEqual(band.filter((segment) => segment.value).map(({ from, to, value, agentSources }) => [from - T, to - T, value, agentSources]),
    [[0, 300_000, 2, CODING_AGENT_CURSOR]]);
});

test("Claude Code cloud usage counts as agent work on the band while the Mac is offline", () => {
  const row = (outputTokens: number, cacheReadTokens = 0) => ({ id: "claude", model: null, inputTokens: 0, outputTokens, cacheReadTokens,
    cacheCreationTokens: 0, reasoningTokens: 0, eventCount: null });
  const store: StoredCodingBuckets = { coverage: [], agents: [{ id: "claude", state: "partial" }], collectedAt: T + 720_000, receivedAt: T + 720_000,
    windows: [{ from: T, agents: [row(5)] }, { from: T + 300_000, agents: [row(0, 9)] }, { from: T + 600_000, agents: [row(3)] }] };
  const cloud = cloudAgentActivity(store);
  assert.deepEqual(cloud, [{ from: T, to: T + 720_000 }], "the current bucket ends at the last receipt");
  assert.deepEqual(codingBand([], [], { from: T - 300_000, to: T + 900_000 }, cloud), [{ from: T, to: T + 720_000, value: 2, agentSources: CODING_AGENT_CLOUD }]);
  const both = codingBand([observation(T, true, false)], [], { from: T, to: T + 900_000 }, cloud);
  assert.deepEqual(both.map((segment) => segment.value), [3, 2]);
  const together = codingBand([observation(T, false, true)], [], { from: T, to: T + 900_000 }, cloud);
  assert.deepEqual(together.map(({ value, agentSources }) => [value, agentSources]), [[2, CODING_AGENT_MAC | CODING_AGENT_CLOUD], [2, CODING_AGENT_CLOUD]],
    "same band value still splits where the running sources change");
  assert.deepEqual(cloudAgentActivity({ ...store, windows: [{ from: T, agents: [row(0)] }] }), []);
});
