import assert from "node:assert/strict";
import test from "node:test";

import { FakeStorage, installTestStorage } from "@shared/testing/fake-storage";
import { parseStoredCodingBuckets } from "@shared/coding-buckets";
import {
  codingBucketsKey,
  codingOtlpKey,
  codingUsageKey,
  codingViewKey,
  parseStoredUsageLedgers,
  parseStoredView,
} from "@shared/coding-store";

import { type CollectedIngest } from "./ingest-effects";
import { prepareIngest as prepareShared, type CoreCommand } from "@shared/ingest/prepare";
import { type ImageBucket } from "@shared/ingest/r2-assets";
import { NOW, commit, fieldsOf, inRequest, testEnv } from "./testing/ingest-harness";

function prepareIngest(source: string, body: unknown, at: number, images: ImageBucket = { head: async () => ({}) }): Promise<CoreCommand> {
  return prepareShared(source, body, at, images) as Promise<CoreCommand>;
}

function otlpTokens(at: number, value: number, type = "input", temporality = 2) {
  const time = `${BigInt(at) * BigInt(1_000_000)}`;
  const attributes = [
    ["session.id", "session-a"], ["user.email", "someone@example.com"], ["model", "claude-fable-5-1"], ["type", type],
  ].map(([key, entry]) => ({ key, value: { stringValue: entry } }));
  return {
    resourceMetrics: [{ scopeMetrics: [{ metrics: [
      { name: "claude_code.active_time.total", sum: { aggregationTemporality: 2, dataPoints: [] } },
      { name: "claude_code.token.usage", sum: { aggregationTemporality: temporality, dataPoints: [
        { attributes, startTimeUnixNano: "1", timeUnixNano: time, asDouble: value },
      ] } },
    ] }] }],
  };
}

test("agents-otlp turns cumulative deltas into day rows, token buckets and activity for claude", async () => {
  const storage = new FakeStorage();
  installTestStorage(storage);
  const env = testEnv();
  const tagged = (result: CollectedIngest<unknown>) =>
    result.effects.some((effect) => effect.kind === "tags" && effect.tags.includes("coding"));
  const pushed = (result: CollectedIngest<unknown>) => result.effects.find((effect) => effect.kind === "event")?.event;
  try {
    const first = await commit(env, await inRequest(env, () => prepareIngest("agents-otlp", otlpTokens(NOW, 100), NOW)));
    assert.equal(first.ok, true);
    assert.equal(tagged(first), true, "the first claude row is a skeleton change");
    assert.deepEqual(pushed(first)?.type === "coding-now" ? pushed(first)?.payload : null, {
      agents: [{ id: "claude", activity: [{ source: "agents-otlp", lastActivityAt: NOW, model: "claude-fable-5-1" }] }],
      lastSeenAt: 0, declaredOffline: false, heartbeatWindowMs: (pushed(first) as { payload: { heartbeatWindowMs: number } }).payload.heartbeatWindowMs,
    });

    const second = await commit(env, await inRequest(env, () => prepareIngest("agents-otlp", otlpTokens(NOW + 60_000, 250), NOW + 60_000)));
    assert.equal(tagged(second), false, "more tokens on the same row are content, not layout");
    assert.equal(pushed(second)?.type, "coding-now");
    const idle = await commit(env, await inRequest(env, () => prepareIngest("agents-otlp", otlpTokens(NOW + 120_000, 250), NOW + 120_000)));
    assert.equal(pushed(idle), undefined);

    const ledger = parseStoredUsageLedgers(await fieldsOf(storage, codingUsageKey("agents-otlp"))).claude;
    assert.equal(ledger?.days.reduce((sum, day) => sum + day.inputTokens, 0), 250);
    assert.equal(ledger?.days[0]?.costComplete, true);
    assert.equal(ledger?.sessionCount, 1);
    const buckets = parseStoredCodingBuckets(await storage.get(codingBucketsKey("agents-otlp")));
    assert.deepEqual(buckets?.coverage, [], "OTLP is positive evidence only");
    assert.equal(buckets?.windows.flatMap((window) => window.agents).reduce((sum, row) => sum + row.inputTokens, 0), 250);
    assert.equal(buckets?.windows[0]?.agents[0]?.eventCount, null);
    const view = parseStoredView(await storage.get(codingViewKey()));
    assert.deepEqual(view?.agents.map((agent) => [agent.id, agent.sources]), [["claude", ["agents-otlp"]]]);
    assert.ok(!JSON.stringify([...Object.values(await fieldsOf(storage, codingUsageKey("agents-otlp"))), await storage.get(codingOtlpKey())]).includes("someone@example.com"));

    await assert.rejects(inRequest(env, () => prepareIngest("agents-otlp", { nope: true }, NOW)));
  } finally { installTestStorage(null); }
});

test("an OTLP commit that fails after the delta is computed writes nothing, so the next export still lands the whole delta", async () => {
  const storage = new FakeStorage();
  installTestStorage(storage);
  const env = testEnv();
  const otlp = (at: number, input: number) => inRequest(env, () => prepareIngest("agents-otlp", otlpTokens(at, input), at));
  const cloudInput = async () => parseStoredUsageLedgers(await fieldsOf(storage, codingUsageKey("agents-otlp"))).claude?.days
    .reduce((sum, day) => sum + day.inputTokens, 0);
  const bucketInput = async () => parseStoredCodingBuckets(await storage.get(codingBucketsKey("agents-otlp")))?.windows
    .flatMap((window) => window.agents).reduce((sum, row) => sum + row.inputTokens, 0);
  try {
    storage.failWhen((commands) => commands.some((command) => command.op === "fields" && command.key === codingUsageKey("mac")));
    assert.equal((await commit(env, await otlp(NOW, 100))).ok, false);
    assert.equal(await storage.get(codingOtlpKey()), null, "the counter must not move ahead of its ledger");
    assert.deepEqual(await fieldsOf(storage, codingUsageKey("agents-otlp")), {});
    assert.equal(await storage.get(codingBucketsKey("agents-otlp")), null);

    storage.failWhen(null);
    assert.equal((await commit(env, await otlp(NOW + 60_000, 100))).ok, true);
    assert.equal(await cloudInput(), 100, "the delta that failed once is not lost");
    assert.equal(await bucketInput(), 100);

    const counters = await storage.get(codingOtlpKey());
    storage.failWhen((commands) => commands.some((command) => command.op === "set" && command.key === codingOtlpKey()));
    await commit(env, await otlp(NOW + 120_000, 180));
    storage.failWhen(null);
    assert.equal(await storage.get(codingOtlpKey()), counters);
    assert.equal(await cloudInput(), 100);
    assert.equal(await bucketInput(), 100);
    assert.equal((await commit(env, await otlp(NOW + 180_000, 180))).ok, true);
    assert.equal(await cloudInput(), 180);
    assert.equal(await bucketInput(), 180);
  } finally { storage.failWhen(null); installTestStorage(null); }
});

test("OTLP envelopes that commit in the opposite order of their receipt keep every delta in the ledger", async () => {
  const storage = new FakeStorage();
  installTestStorage(storage);
  const env = testEnv();
  const ledger = async () => parseStoredUsageLedgers(await fieldsOf(storage, codingUsageKey("agents-otlp"))).claude!;
  const bucketTotal = async () => parseStoredCodingBuckets(await storage.get(codingBucketsKey("agents-otlp")))?.windows
    .flatMap((window) => window.agents).reduce((sum, row) => sum + row.inputTokens + row.outputTokens, 0);
  try {
    const a = await inRequest(env, () => prepareIngest("agents-otlp", otlpTokens(NOW, 100, "input"), NOW));
    const b = await inRequest(env, () => prepareIngest("agents-otlp", otlpTokens(NOW + 1_000, 50, "output"), NOW + 1_000));
    assert.equal((await commit(env, b)).ok, true);
    assert.equal((await commit(env, a)).ok, true);
    assert.equal((await ledger()).days.reduce((sum, day) => sum + day.totalTokens, 0), 150, "A's delta is not dropped as a stale snapshot");
    assert.equal(await bucketTotal(), 150, "the ledger and the buckets agree");
    assert.equal((await ledger()).collectedAt, NOW + 1_000, "the collection time does not move back");
    assert.equal((await commit(env, a)).ok, true);
    assert.equal((await ledger()).days.reduce((sum, day) => sum + day.totalTokens, 0), 150);
    assert.equal(await bucketTotal(), 150);
  } finally { installTestStorage(null); }
});

test("delta-temporality OTLP points are not counted, so a retry after a lost receipt cannot double count", async () => {
  const storage = new FakeStorage();
  installTestStorage(storage);
  const env = testEnv();
  const warnings: unknown[][] = [];
  const previous = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args); };
  try {
    const delta = await inRequest(env, () => prepareIngest("agents-otlp", otlpTokens(NOW, 100, "input", 1), NOW));
    assert.equal((await commit(env, delta)).ok, true);
    assert.equal((await commit(env, delta)).ok, true);
    const tokens = parseStoredUsageLedgers(await fieldsOf(storage, codingUsageKey("agents-otlp"))).claude?.days
      .reduce((sum, day) => sum + day.totalTokens, 0) ?? 0;
    assert.equal(tokens, 0, "delta points cannot be deduplicated, so none are counted (not 200)");
    assert.equal(await storage.get(codingBucketsKey("agents-otlp")), null);
    assert.ok(warnings.some((args) => String(args[0]).includes("delta temporality")), "a missing cumulative setting shows up as a warning");
    assert.equal((await commit(env, await inRequest(env, () => prepareIngest("agents-otlp", otlpTokens(NOW + 60_000, 70), NOW + 60_000)))).ok, true);
    assert.equal(parseStoredUsageLedgers(await fieldsOf(storage, codingUsageKey("agents-otlp"))).claude?.days
      .reduce((sum, day) => sum + day.totalTokens, 0), 70);
  } finally { console.warn = previous; installTestStorage(null); }
});
