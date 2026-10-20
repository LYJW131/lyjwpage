import assert from "node:assert/strict";
import test from "node:test";
import { codingObservationsKey, cursorObservationsKey } from "./coding-pulse";
import { codingBucketsKey } from "@shared/coding-store";
import { CODING_OBSERVATION_HOLD_MS, PULSE_SCORE_WINDOW_MS } from "@shared/pulse-coding";
import { latestPulseAssessments } from "@shared/pulse-assessment";
import { pulseAssessmentsKey } from "./pulse-assessments";
import { installTestStorage } from '@shared/testing/fake-storage';
import { withRequestState } from '@shared/request-state';
import { requestStore, type Env } from './runtime';
import { commitPreparedAgentsReport } from './stores/agents';
import { prepareAgentLimits } from '@shared/ingest/agents';
import { T, setup, storedBuckets } from "./testing/pulse-score-harness";

async function quietCoding(b: ReturnType<typeof setup>, from: number) {
  for (let index = 0; index < PULSE_SCORE_WINDOW_MS / CODING_OBSERVATION_HOLD_MS; index += 1) {
    await b.storage.append(codingObservationsKey(), JSON.stringify({
      t: from + index * CODING_OBSERVATION_HOLD_MS, available: true,
      desktop: { application: "Safari", coding: false }, agents: [],
    }));
  }
}

test("fully observed zero windows skip the decision model and store the lowest certain score", async () => {
  const b = setup();
  await quietCoding(b, T);
  await b.storage.set(codingBucketsKey("mac"), storedBuckets({
    from: T, to: T + PULSE_SCORE_WINDOW_MS, collectedAt: T + PULSE_SCORE_WINDOW_MS + 60_000,
    sources: [{ id: "codex", state: "ok" }, { id: "claude", state: "ok" }], windows: [],
  }));
  await b.make().run();
  assert.equal(b.requests.length, 0);
  const rows = latestPulseAssessments(await b.storage.listRange(pulseAssessmentsKey(), 0, -1));
  assert.deepEqual(rows.map((row) => row.domain), ["coding"]);
  for (const row of rows) {
    assert.equal(row.model, "rules");
    assert.equal(row.to - row.from, PULSE_SCORE_WINDOW_MS);
    assert.deepEqual(row.coverage, [{ from: row.from, to: row.to }]);
    assert.equal(row.intensity.value, 0);
    assert.equal(row.intensity.confidence, 1);
    assert.equal(row.intensity.probabilities["0"], 1);
    assert.equal(Object.values(row.intensity.probabilities).reduce((sum, p) => sum + p, 0), 1);
    assert.equal(row.continuity.value, 0);
    assert.equal(row.continuity.confidence, 1);
    assert.equal(row.continuity.probabilities["0"], 1);
    assert.equal(row.mode?.value, "idle");
    assert.equal(row.mode?.confidence, 1);
    assert.equal(row.mode?.probabilities.idle, 1);
  }
  await b.make().run();
  assert.equal(b.requests.length, 0);
  assert.equal((await b.storage.listRange(pulseAssessmentsKey(), 0, -1)).length, 1);
});

test("missing token evidence still calls the decision model for an idle-looking window", async () => {
  const b = setup();
  await quietCoding(b, T);
  await b.make().run();
  assert.equal(b.requests.length, 1);
  const rows = latestPulseAssessments(await b.storage.listRange(pulseAssessmentsKey(), 0, -1));
  assert.ok(rows.every((row) => row.model === "clef"));
  assert.equal((b.requests[0].state as { windows: { tokenUsage: unknown }[] }).windows[0].tokenUsage, null);
});

test("a zero window is skipped while another coding window still calls the decision model", async () => {
  const b = setup();
  await quietCoding(b, T);
  const next = T + PULSE_SCORE_WINDOW_MS;
  for (let index = 0; index < 5; index += 1) await b.push(next + index * CODING_OBSERVATION_HOLD_MS);
  await b.storage.set(codingBucketsKey("mac"), storedBuckets({
    from: T, to: next + PULSE_SCORE_WINDOW_MS, collectedAt: next + PULSE_SCORE_WINDOW_MS + 60_000,
    sources: [{ id: "codex", state: "ok" }, { id: "claude", state: "ok" }], windows: [],
  }));
  b.advance(PULSE_SCORE_WINDOW_MS);
  await b.make().run();
  assert.equal(b.requests.length, 1);
  const rows = latestPulseAssessments(await b.storage.listRange(pulseAssessmentsKey(), 0, -1));
  assert.equal(rows.find((row) => row.from === T)?.model, "rules");
  assert.equal(rows.find((row) => row.from === T)?.mode?.value, "idle");
  assert.equal(rows.find((row) => row.from === next)?.model, "clef");
  assert.ok((rows.find((row) => row.from === next)?.intensity.value ?? 0) > 0);
});

test("Mac-offline account evidence reaches scoring and the public chart, then disappears after source expiry", async () => {
  const b = setup();
  installTestStorage(b.storage);
  const pending: Promise<unknown>[] = [];
  try {
    await requestStore.run({ env: { LIVE_PUSH: { idFromName: () => null, get: () => ({ broadcast: async () => {} }) } } as unknown as Env,
      ctx: { waitUntil: (promise: Promise<unknown>) => { pending.push(promise); } } }, () => withRequestState(async () => {
      await commitPreparedAgentsReport(prepareAgentLimits({ codingUsage: { agents: [{ id: 'cursor', state: 'ok', collectedAt: T, error: null,
        warning: null, sessionCount: null, days: [] }] } }, T));
    }));
  } finally { await Promise.allSettled(pending); installTestStorage(null); }
  await b.make().run();
  assert.equal(b.requests.length, 0, "checked but inactive sources use a limited-confidence zero baseline");
  const { codingLaneView } = await import('./pulse');
  const rows = latestPulseAssessments(await b.storage.listRange(pulseAssessmentsKey(), 0, -1));
  assert.deepEqual(rows.map((row) => row.domain), ['coding']);
  for (const row of rows) {
    assert.deepEqual(row.coverage, [{ from: T, to: T + PULSE_SCORE_WINDOW_MS }]);
    assert.equal(row.model, 'rules:limited-source');
    assert.equal(row.intensity.value, 0);
    assert.equal(row.intensity.confidence, 0.5);
    assert.equal(row.continuity.value, 0);
    assert.equal(row.mode?.value, 'idle');
    const exposed = codingLaneView([], [], [row], { from: T, to: T + PULSE_SCORE_WINDOW_MS });
    assert.deepEqual(exposed.assessments, { startSec: [0], endSec: [900], intensity: [0], confidence: [0.5], mode: ['idle'] });
    assert.equal(JSON.stringify(exposed).includes('cursor'), false, "private source facts stay internal");
  }
  b.advance(2 * 3_600_000);
  await b.make().run();
  const later = latestPulseAssessments(await b.storage.listRange(pulseAssessmentsKey(), 0, -1));
  assert.equal(later.some((r) => r.from >= T + 75 * 60_000), false, "expired sources never fill later windows");
});


test("independent source baseline never hides Cursor or token activity", async () => {
  const cursor = setup();
  await cursor.storage.append(cursorObservationsKey(), JSON.stringify({ t: T, available: true, lastActivityAt: T }));
  await cursor.make().run();
  assert.equal(cursor.requests.length, 1);
  assert.equal((cursor.requests[0].state as { windows: { cursorActiveSeconds: number }[] }).windows[0].cursorActiveSeconds, 300);
  const token = setup();
  await token.storage.append(cursorObservationsKey(), JSON.stringify({ t: T, available: true, lastActivityAt: null }));
  await token.storage.set(codingBucketsKey("mac"), storedBuckets({ from: T, to: T + 300_000, collectedAt: T + 300_000,
    sources: [{ id: 'codex', state: 'ok' }, { id: 'claude', state: 'unavailable' }], windows: [{ from: T, to: T + 300_000, agents: [{ id: 'codex', model: null,
      inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0, eventCount: 1 }] }] }));
  await token.make().run();
  assert.equal(token.requests.length, 1);
});


test("Cursor coverage does not turn a missing Mac agent module into a certain zero", async () => {
  const b = setup();
  for (let t = T; t < T + PULSE_SCORE_WINDOW_MS; t += 120_000) {
    await b.storage.append(codingObservationsKey(), JSON.stringify({ t, available: true, desktop: { application: 'Finder', coding: false }, agents: null }));
  }
  await b.storage.append(cursorObservationsKey(), JSON.stringify({ t: T, available: true, lastActivityAt: null }));
  await b.storage.set(codingBucketsKey("mac"), storedBuckets({ from: T, to: T + PULSE_SCORE_WINDOW_MS, collectedAt: T + PULSE_SCORE_WINDOW_MS,
    sources: [{ id: 'codex', state: 'ok' }, { id: 'claude', state: 'ok' }], windows: [] }));
  await b.make().run();
  assert.equal(b.requests.length, 1);
});


test("token evidence from the Cursor account and Claude Code cloud counts only as positive evidence; certain zero needs the Mac range", async () => {
  const row = (id: string, inputTokens: number, eventCount: number | null) => ({ id, model: null, inputTokens, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0, eventCount });
  const extra = (source: "agents" | "agents-otlp", id: string, eventCount: number | null) => JSON.stringify({
    coverage: [], agents: [{ id, state: "partial" }], windows: [{ from: T + 300_000, agents: [row(id, 7, eventCount)] }],
    collectedAt: T + 900_000, receivedAt: T + 900_000,
  });
  const b = setup();
  await quietCoding(b, T);
  await b.storage.set(codingBucketsKey("mac"), storedBuckets({ from: T, to: T + PULSE_SCORE_WINDOW_MS, collectedAt: T + PULSE_SCORE_WINDOW_MS,
    sources: [{ id: "codex", state: "ok" }, { id: "claude", state: "ok" }], windows: [] }));
  await b.storage.set(codingBucketsKey("agents-otlp"), extra("agents-otlp", "claude", null));
  await b.make().run();
  assert.equal(b.requests.length, 1);
  const token = (b.requests[0].state as { windows: { tokenUsage: { observedBucketCount: number; sources: { source: string; id: string; state: string }[]; agents: { source: string; id: string; inputTokens: number; eventCount: number | null }[] } }[] }).windows[0].tokenUsage;
  assert.equal(token.observedBucketCount, 3);
  assert.deepEqual(token.sources.map((source) => [source.source, source.id, source.state]), [["mac", "codex", "ok"], ["mac", "claude", "ok"], ["agents-otlp", "claude", "partial"]]);
  assert.deepEqual(token.agents.map((agent) => [agent.source, agent.id, agent.inputTokens, agent.eventCount]), [["agents-otlp", "claude", 7, null]]);

  const cursor = setup();
  await cursor.push(T);
  await cursor.storage.set(codingBucketsKey("agents"), extra("agents", "cursor", 3));
  await cursor.make().run();
  const cursorToken = (cursor.requests[0].state as { windows: { tokenUsage: { observedBucketCount: number; unknownBucketCount: number; agents: { source: string; eventCount: number | null }[] } }[] }).windows[0].tokenUsage;
  assert.deepEqual([cursorToken.observedBucketCount, cursorToken.unknownBucketCount], [0, 3]);
  assert.deepEqual(cursorToken.agents.map((agent) => [agent.source, agent.eventCount]), [["agents", 3]]);
});

test("a Cursor request billed without tokens (0 tokens, one event) is still activity evidence, not a certain zero", async () => {
  const b = setup();
  await quietCoding(b, T);
  await b.storage.set(codingBucketsKey("mac"), storedBuckets({ from: T, to: T + PULSE_SCORE_WINDOW_MS, collectedAt: T + PULSE_SCORE_WINDOW_MS,
    sources: [{ id: "codex", state: "ok" }, { id: "claude", state: "ok" }], windows: [] }));
  await b.storage.set(codingBucketsKey("agents"), JSON.stringify({
    coverage: [{ from: T - 600_000, to: T + PULSE_SCORE_WINDOW_MS }], agents: [{ id: "cursor", state: "partial" }],
    windows: [{ from: T + 600_000, agents: [{ id: "cursor", model: "composer-2", inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0, eventCount: 1 }] }],
    collectedAt: T + PULSE_SCORE_WINDOW_MS, receivedAt: T + PULSE_SCORE_WINDOW_MS,
  }));
  await b.make().run();
  assert.equal(b.requests.length, 1, "the decision model judges the window");
  const rows = latestPulseAssessments(await b.storage.listRange(pulseAssessmentsKey(), 0, -1));
  assert.equal(rows[0]?.model, "clef");
});
