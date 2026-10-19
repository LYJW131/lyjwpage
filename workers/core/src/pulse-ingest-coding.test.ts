import assert from "node:assert/strict";
import test from "node:test";

import { codingObservationsKey, cursorObservationsKey } from "./coding-pulse";
import {
  pulseLaneOpenKey,
} from "./pulse-keys";
import { commitPreparedAgentsReport } from "@core/stores/agents";
import { commitPreparedTelemetryEnvelope } from "@core/stores/telemetry";
import { prepareAgentLimits } from "@shared/ingest/agents";
import { prepareTelemetryEnvelope } from "@shared/ingest/telemetry";
import { T0, envelope, inRequest, withStorage } from "./testing/pulse-ingest-harness";

const recordTelemetryEnvelope = (input: unknown, at: number) => commitPreparedTelemetryEnvelope(prepareTelemetryEnvelope(input, at));
const recordAgentsReport = (input: unknown, at: number) => commitPreparedAgentsReport(prepareAgentLimits(input, at));

test("desktop 模块关掉后，留着的前台应用不再被记成 coding", withStorage(async (storage) => {
  await inRequest(() => recordTelemetryEnvelope(envelope(T0, ["desktop"], {
    desktop: { applicationName: "Cursor", bundleIdentifier: "com.todesktop.230313mzl4w4u92" },
  }), T0));
  const off = T0 + 60_000;
  await inRequest(() => recordTelemetryEnvelope(envelope(off, ["coding"], {
    codingActivity: { collectedAt: off, agents: [{ id: "claude", lastActivityAt: null, model: null }] },
  }), off));
  const rows = (await storage.listRange(codingObservationsKey(), 0, -1)).map((raw) => JSON.parse(raw));
  assert.deepEqual(rows.map((row) => row.desktop), [{ application: "Cursor", coding: true }, null]);
  assert.equal(await storage.get(pulseLaneOpenKey("listening")), null, "no appleMusic module means listening is not observed");
}));

function activity(at: number, lastActivityAt: number | null, id = "claude", model: string | null = "claude-opus-5") {
  return { codingActivity: { collectedAt: at, agents: [{ id, lastActivityAt, model }] } };
}

test("agent 在不在跑按活动时刻现算：最近事件 5 分钟内算在跑，之后不算；保活续命，采集时刻 10 分钟不动才当未知", withStorage(async (storage) => {
  await inRequest(() => recordTelemetryEnvelope(envelope(T0, ["coding"], activity(T0, T0 - 30_000)), T0));
  const quiet = T0 + 6 * 60_000;
  await inRequest(() => recordTelemetryEnvelope(envelope(quiet, ["coding"]), quiet));
  const kept = T0 + 9 * 60_000;
  await inRequest(() => recordTelemetryEnvelope(envelope(kept, ["coding"], activity(kept, T0 - 30_000)), kept));
  const stillKnown = T0 + 18 * 60_000;
  await inRequest(() => recordTelemetryEnvelope(envelope(stillKnown, ["coding"]), stillKnown));
  const stale = T0 + 20 * 60_000;
  await inRequest(() => recordTelemetryEnvelope(envelope(stale, ["coding"]), stale));
  const off = T0 + 21 * 60_000;
  await inRequest(() => recordTelemetryEnvelope(envelope(off, ["coding"], activity(off, off - 1_000)), off));
  await inRequest(() => recordTelemetryEnvelope(envelope(off + 30_000, []), off + 30_000));
  const rows = (await storage.listRange(codingObservationsKey(), 0, -1)).map((raw) => JSON.parse(raw));
  assert.deepEqual(rows.map((row) => row.agents?.[0]?.active ?? null), [true, false, false, false, null, true, null]);
  assert.deepEqual(rows[0].agents, [{ id: "claude", model: "claude-opus-5", active: true }]);
  assert.equal(rows[4].available, false);
}));

test("Coding observations keep foreground changes and idle heartbeats, and stop on explicit offline", withStorage(async (storage) => {
  await inRequest(() => recordTelemetryEnvelope(envelope(T0, ["desktop", "coding"], {
    desktop: { applicationName: "Cursor", bundleIdentifier: "com.todesktop.230313mzl4w4u92" },
    ...activity(T0, T0 - 5_000, "codex", "<synthetic>"),
  }), T0));
  await inRequest(() => recordTelemetryEnvelope(envelope(T0 + 20_000, ["desktop", "coding"], {
    desktop: { applicationName: "Zed", bundleIdentifier: "dev.zed.Zed" },
  }), T0 + 20_000));
  await inRequest(() => recordTelemetryEnvelope(envelope(T0 + 110_000, ["desktop", "coding"]), T0 + 110_000));
  await inRequest(() => recordTelemetryEnvelope({ ...envelope(T0 + 120_000, ["desktop", "coding"]), presence: "offline" }, T0 + 120_000));
  const rows = (await storage.listRange(codingObservationsKey(), 0, -1)).map((raw) => JSON.parse(raw));
  assert.equal(rows.length, 4);
  assert.equal(rows[0].desktop.application, "Cursor");
  assert.deepEqual(rows[0].agents, [{ id: "codex", model: null, active: true }], "placeholder model names never become a model");
  assert.equal(rows[1].desktop.application, "Zed");
  assert.equal(rows[2].agents[0].active, true);
  assert.equal(rows[3].available, false);
}));

test("Cursor history success renews independent account observations even without newer activity", withStorage(async (storage) => {
  const at = Date.now();
  const usage = (t: number, extra: Record<string, unknown> = {}) => ({
    agents: [{ id: "cursor", state: "ok", collectedAt: t, error: null, warning: null, sessionCount: null, days: [], ...extra }],
  });
  const now = (t: number, lastActivityAt: number) => ({ collectedAt: t, agents: [{ id: "cursor", lastActivityAt, model: "cursor-model" }] });
  await inRequest(async () => {
    await recordAgentsReport({ codingActivity: now(at, at) }, at);
    await recordAgentsReport({ codingActivity: now(at + 30_000, at) }, at + 30_000);
    await recordAgentsReport({ codingUsage: usage(at + 60_000) }, at + 60_000);
    await recordAgentsReport({ codingUsage: usage(at + 60_000) }, at + 120_000);
    await recordAgentsReport({ codingUsage: usage(at - 60_000) }, at + 180_000);
    const rows = (await storage.listRange(cursorObservationsKey(), 0, -1)).map((raw) => JSON.parse(raw));
    assert.deepEqual(rows, [{ t: at, available: true, lastActivityAt: at }, { t: at + 60_000, available: true, lastActivityAt: at }]);
    await recordAgentsReport({ codingUsage: usage(at + 240_000, { warning: "incomplete history" }) }, at + 240_000);
    assert.equal(JSON.parse((await storage.listRange(cursorObservationsKey(), -1, -1))[0]).available, false);
  });
}));

test("Mac token buckets are stored internally and never enter the coding-now push", withStorage(async (storage) => {
  const { codingBucketsKey } = await import("@shared/coding-store");
  const { parseStoredCodingBuckets } = await import("@shared/coding-buckets");
  const from = 1_800_000_000_000;
  const at = from + 420_000;
  const codingTokenBuckets = { from, to: from + 300_000, collectedAt: at, agents: [{ id: "codex", state: "ok" }, { id: "claude", state: "unavailable" }],
    windows: [{ from, agents: [{ id: "codex", model: "test", inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 5, eventCount: 1 }] }] };
  const pushed: string[] = [];
  await inRequest(async () => {
    const { collectIngestEffects } = await import("@core/ingest-effects");
    const result = await collectIngestEffects(() => recordTelemetryEnvelope(envelope(at, ["coding"], {
      codingTokenBuckets, codingActivity: { collectedAt: at, agents: [{ id: "codex", lastActivityAt: at - 1_000, model: "test" }] },
    }), at));
    for (const effect of result.effects) if (effect.kind === "event") pushed.push(JSON.stringify(effect.event));
  });
  const stored = parseStoredCodingBuckets(await storage.get(codingBucketsKey("mac")));
  assert.deepEqual(stored?.coverage, [{ from, to: from + 300_000 }]);
  assert.equal(stored?.windows[0]?.agents[0]?.outputTokens, 20);
  assert.equal(pushed.length, 1);
  assert.equal(pushed.some((event) => event.includes("outputTokens")), false);
}));
