import assert from "node:assert/strict";
import test from "node:test";

import { readChargerState } from "@/lib/charger-store";
import { getImageObjectKeys } from "@/lib/emby-store";
import { readLiveness } from "@/lib/reporter-liveness";
import { installStorageForTests, resetStorageForTests } from "@/lib/storage";
import { FakeStorage } from "@/lib/testing/fake-storage";
import { HIDDEN_DESKTOP_BUNDLE_ID } from "@/lib/types";
import { pulseWorkoutsKey } from "@/lib/pulse-keys";
import { withRequestState } from "@shared/request-state";
import { K_LAST_PUSH } from "@shared/charger-store";
import { parseStoredCodingBuckets } from "@shared/coding-buckets";
import {
  codingActivityKey,
  codingBucketsKey,
  codingOtlpKey,
  codingUsageKey,
  codingViewKey,
  codingYearKey,
  parseStoredActivity,
  parseStoredUsageLedgers,
  parseStoredView,
} from "@shared/coding-store";
import { mirror as telemetryMirror } from "@shared/telemetry";

import { fanout } from "./fanout";
import { collectIngestEffects, dispatchIngestEffects, type CollectedIngest } from "./ingest-effects";
import { prepareIngest as prepareShared, type CoreCommand } from "@shared/ingest/prepare";
import { resetStoredImageCacheForTests, type ImageBucket } from "@shared/ingest/r2-assets";
import type { PreparedTelemetryEnvelope } from "@shared/ingest/telemetry";
import { commitPreparedIngest } from "./ingest-handlers";
import { enrichCommand } from "./listening-enrichment";
import { trackLookupCacheKey } from "@/lib/apple-music";
import { installAppleCacheForTests } from "../../../src/lib/apple-cache-store";
import { motionArtworkCacheKey } from "@/lib/motion-artwork";
import { parseAppleMusicUrl } from "@/lib/motion-artwork-url";
import { MemoryKv } from "@/lib/testing/memory-kv";
import { requestStore, type Env } from "./runtime";

const NOW = 1_800_000_000_000;
const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);

function envelope(modules: Record<string, unknown>, activeModules: string[] = []) {
  return { version: 4, presence: "online", heartbeatAt: NOW, activeModules, modules };
}

function prepareIngest(source: string, body: unknown, at: number, images: ImageBucket = { head: async () => ({}) }): Promise<CoreCommand> {
  return prepareShared(source, body, at, images) as Promise<CoreCommand>;
}

function testEnv(): Env {
  return {
    LIVE_PUSH: {
      idFromName: () => null,
      get: () => ({ broadcast: async () => { throw new Error("DO commit must not broadcast"); } }),
    } as unknown as Env["LIVE_PUSH"],
  } as Env;
}

async function inRequest<T>(env: Env, run: () => Promise<T>): Promise<T> {
  const pending: Promise<unknown>[] = [];
  try {
    return await requestStore.run({
      env,
      ctx: { waitUntil: (promise) => { pending.push(promise); } },
    }, () => withRequestState(run));
  } finally {
    await Promise.allSettled(pending);
  }
}

async function commit(env: Env, command: CoreCommand): Promise<CollectedIngest<unknown>> {
  return inRequest(env, () => collectIngestEffects(() => commitPreparedIngest(command)));
}

test("Mac late validation keeps liveness but does not invent a charger heartbeat", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  try {
    const command = await inRequest(testEnv(), () => prepareIngest(
      "mac",
      envelope({ chargingDevices: "bad" }, ["charger"]),
      NOW,
    ));
    const result = await commit(testEnv(), command);
    assert.equal(result.ok, false);
    assert.equal((await readLiveness()).lastSeenAt, NOW);
    assert.equal(await storage.get(K_LAST_PUSH), null);
  } finally { resetStorageForTests(); }
});

test("Mac commits the charger before a later malformed power bank and omits later modules", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  try {
    const command = await inRequest(testEnv(), () => prepareIngest("mac", envelope({
      chargingDevices: { devices: [
        { id: "charger", kind: "charger", connected: true, updatedAt: NOW, totalOutputW: 40 },
        { id: "bank", kind: "powerBank", connected: true },
      ] },
      desktop: { applicationName: "Should not land" },
    }, ["charger", "desktop"]), NOW));
    const result = await commit(testEnv(), command);
    assert.equal(result.ok, false);
    assert.equal((await readChargerState()).previous?.status.totalPower, 40);
    assert.equal(result.effects.some((effect) => effect.kind === "event" && effect.event.type === "desktop"), false);
  } finally { resetStorageForTests(); }
});

test("Mac keeps an earlier charger write when desktop validation fails and does not commit later coding", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  try {
    const command = await inRequest(testEnv(), () => prepareIngest("mac", envelope({
      chargingDevices: { devices: [
        { id: "charger", kind: "charger", connected: true, updatedAt: NOW, totalOutputW: 32 },
      ] },
      desktop: { bundleIdentifier: "missing.application.name" },
      codingActivity: { collectedAt: NOW, agents: [{ id: "codex", lastActivityAt: NOW - 1_000, model: "gpt-6" }] },
    }, ["charger", "desktop", "coding"]), NOW));
    const result = await commit(testEnv(), command);
    assert.equal(result.ok, false);
    assert.equal((await readChargerState()).previous?.status.totalPower, 32);
    assert.equal(await storage.get(codingActivityKey("mac")), null);
  } finally { resetStorageForTests(); }
});

async function fieldsOf(storage: FakeStorage, name: string): Promise<Record<string, string>> {
  return (await storage.batch().fields(name).execute())[0] as Record<string, string>;
}

function usageDay(date: string, totalTokens: number, model = "claude-opus-5") {
  return {
    date, inputTokens: totalTokens, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0,
    totalTokens, apiEquivalentCostUSD: totalTokens / 1_000, costComplete: true, models: [{ model, tokens: totalTokens }],
  };
}

test("a broken coding module is dropped at the ingress; desktop, liveness and the other coding modules still commit", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  try {
    const command = await inRequest(testEnv(), () => prepareIngest("mac", envelope({
      desktop: { applicationName: "Xcode", bundleIdentifier: "com.apple.dt.Xcode" },
      codingUsage: { agents: [{ id: "claude", state: "ok", collectedAt: NOW, days: [{ ...usageDay("2026-09-29", 10), totalTokens: 1 }] }] },
      codingActivity: { collectedAt: NOW, agents: [{ id: "claude", lastActivityAt: NOW - 30_000, model: "claude-opus-5" }] },
    }, ["desktop", "coding"]), NOW)) as PreparedTelemetryEnvelope;
    assert.deepEqual(command.rejected.map((entry) => entry.module), ["codingUsage"]);
    const result = await commit(testEnv(), command);
    assert.equal(result.ok, true);
    assert.equal((await readLiveness()).lastSeenAt, NOW);
    assert.equal((await telemetryMirror.get())?.desktop?.applicationName, "Xcode");
    assert.equal(await storage.get(codingViewKey()), null, "the rejected usage never reached the state core");
    const pushed = result.effects.flatMap((effect) => effect.kind === "event" && effect.event.type === "coding-now" ? [effect.event.payload] : []);
    assert.deepEqual(pushed.map((payload) => payload.agents), [[
      { id: "claude", activity: [{ source: "mac", lastActivityAt: NOW - 30_000, model: "claude-opus-5" }] },
    ]]);
    assert.equal(pushed[0]?.lastSeenAt, NOW, "the push carries the Mac liveness of this very envelope");
  } finally { resetStorageForTests(); }
});

test("Mac usage replaces its ledgers, recomputes the view and tags the first screen only when the skeleton changes", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  const env = testEnv();
  const tags = (result: CollectedIngest<unknown>) => result.effects.flatMap((effect) => effect.kind === "tags" ? effect.tags : []);
  const usage = (at: number, agents: unknown[]) => inRequest(env, () => prepareIngest("mac", envelope({ codingUsage: { agents } }, ["coding"]), at));
  const claude = (tokens: number, at: number) => ({ id: "claude", state: "ok", collectedAt: at, sessionCount: 3, days: [usageDay("2026-09-29", tokens)] });
  try {
    const first = await commit(env, await usage(NOW, [claude(100, NOW)]));
    assert.deepEqual(tags(first), ["coding"]);
    assert.equal(parseStoredView(await storage.get(codingViewKey()))?.totals?.totalTokens, 100);

    const content = await commit(env, await usage(NOW + 60_000, [claude(150, NOW + 60_000)]));
    assert.deepEqual(tags(content), [], "numbers moved, the card kept its rows");
    assert.equal(parseStoredView(await storage.get(codingViewKey()))?.totals?.totalTokens, 150);

    const failed = await commit(env, await usage(NOW + 120_000, [
      { id: "claude", state: "error", collectedAt: NOW + 60_000, error: "ccusage timed out" },
      { id: "codex", state: "ok", collectedAt: NOW + 120_000, days: [usageDay("2026-09-29", 5, "gpt-6")] },
    ]));
    assert.deepEqual(tags(failed), ["coding"], "a new agent row is a skeleton change");
    const ledgers = parseStoredUsageLedgers(await fieldsOf(storage, codingUsageKey("mac")));
    assert.equal(ledgers.claude?.state, "error");
    assert.equal(ledgers.claude?.days[0]?.totalTokens, 150);
    const view = parseStoredView(await storage.get(codingViewKey()))!;
    assert.equal(view.totals?.totalTokens, 155);
    assert.deepEqual(view.agents.find((agent) => agent.id === "claude")?.status.map((row) => row.state), ["error"]);
  } finally { resetStorageForTests(); }
});
test("a later Mac module failure does not notify an unpersisted telemetry patch", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  try {
    const command = await inRequest(testEnv(), () => prepareIngest("mac", envelope({
      desktop: { applicationName: "Cursor", observedAt: NOW },
      appleMusicCredentials: {},
    }, ["desktop"]), NOW));
    const result = await commit(testEnv(), command);
    assert.equal(result.ok, false);
    assert.equal(await telemetryMirror.get(), null);
    assert.equal(result.effects.some((effect) =>
      effect.kind === "event" && effect.event.type === "desktop"), false);
    assert.equal(result.effects.some((effect) =>
      effect.kind === "tags" && effect.tags.includes("desktop")), false);
  } finally { resetStorageForTests(); }
});

test("iPhone keeps the Pulse workout copy when the following activity module is invalid", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  try {
    const workout = {
      id: "11111111-1111-4111-8111-111111111111",
      activityType: "Running",
      startedAt: NOW - 3_600_000,
      endedAt: NOW - 1_800_000,
      durationSeconds: 1_500,
      secondsFromGMT: 0,
    };
    const command = await inRequest(testEnv(), () => prepareIngest("iphone", {
      version: 1,
      modules: { workouts: { items: [workout] }, activity: { date: "bad" } },
    }, NOW));
    const result = await commit(testEnv(), command);
    assert.equal(result.ok, false);
    assert.equal(JSON.parse((await storage.get(pulseWorkoutsKey()))!).items[0]?.activityType, workout.activityType);
  } finally { resetStorageForTests(); }
});

test("fanout exposes no notification when its corresponding durable write fails", async () => {
  const result = await inRequest(testEnv(), () => collectIngestEffects(() => fanout({
    writes: [Promise.reject(new Error("write failed"))],
    events: [{ type: "presence", payload: null }],
    tags: ["desktop"],
  })));
  assert.equal(result.ok, false);
  assert.deepEqual(result.effects, []);
});

test("one failed event does not turn a durable commit into failure or drop other effects", async () => {
  const previous = console.error;
  console.error = () => {};
  try {
    const result = await inRequest(testEnv(), () => collectIngestEffects(() => fanout({
      writes: [Promise.resolve()],
      events: [
        Promise.reject(new Error("optional decoration failed")),
        { type: "presence", payload: null },
      ],
      tags: ["desktop"],
    })));
    assert.equal(result.ok, true);
    assert.deepEqual(result.effects, [
      { kind: "event", event: { type: "presence", payload: null } },
      { kind: "tags", tags: ["desktop"] },
    ]);
  } finally {
    console.error = previous;
  }
});

test("Emby R2 HEAD runs during ingress preparation and does not block another source commit", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let heads = 0;
  const env = testEnv();
  try {
    const emby = prepareIngest("emby", {
      images: [{ imageKey: "item:poster", objectKey: `${HASH_A}.webp` }],
    }, NOW, { head: async () => { heads += 1; await blocked; return {}; } });
    await Promise.resolve();
    assert.equal(heads, 1);

    const phone = await prepareIngest("iphone", { version: 1 }, NOW);
    const phoneResult = await commit(env, phone);
    assert.equal(phoneResult.ok, true);
    release();
    const preparedEmby = await emby as Extract<CoreCommand, { source: "emby" }>;
    assert.deepEqual(preparedEmby.images, [{ key: "item:poster", objectKey: `${HASH_A}.webp` }]);

    resetStoredImageCacheForTests();
    const embyResult = await commit(env, preparedEmby);
    assert.equal(embyResult.ok, true);
    assert.deepEqual(await getImageObjectKeys(), { "item:poster": `${HASH_A}.webp` });
  } finally { release(); resetStorageForTests(); }
});

test("Emby image commits merge against the latest map without losing concurrent keys", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  const env = testEnv();
  try {
    const [first, second] = await Promise.all([
      prepareIngest("emby", { images: [{ imageKey: "a", objectKey: `${HASH_A}.webp` }] }, NOW),
      prepareIngest("emby", { images: [{ imageKey: "b", objectKey: `${HASH_B}.webp` }] }, NOW + 1),
    ]);
    assert.equal((await commit(env, first)).ok, true);
    assert.equal((await commit(env, second)).ok, true);
    assert.deepEqual(await getImageObjectKeys(), { a: `${HASH_A}.webp`, b: `${HASH_B}.webp` });
  } finally { resetStorageForTests(); }
});

test("Cursor activity-only agents envelopes push the whole coding-now payload, and only when it moved", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  const env = testEnv();
  try {
    const mac = await inRequest(env, () => prepareIngest("mac", envelope({
      codingActivity: { collectedAt: NOW, agents: [{ id: "claude", lastActivityAt: NOW - 10_000, model: "claude-opus-5" }] },
    }, ["coding"]), NOW));
    assert.equal((await commit(env, mac)).ok, true);

    const activity = (at: number, lastActivityAt: number, model = "grok-4.7-xhigh") => inRequest(env, () => prepareIngest("agents", {
      collectedAt: new Date(at).toISOString(),
      codingActivity: { collectedAt: at, agents: [{ id: "cursor", lastActivityAt, model }] },
    }, at));
    const result = await commit(env, await activity(NOW + 60_000, NOW + 30_000));
    assert.equal(result.ok, true);
    assert.deepEqual(parseStoredActivity(await storage.get(codingActivityKey("agents")))?.agents, [{ id: "cursor", lastActivityAt: NOW + 30_000, model: "grok-4.7-xhigh" }]);
    const pushed = result.effects.flatMap((effect) => effect.kind === "event" && effect.event.type === "coding-now" ? [effect.event.payload] : []);
    assert.equal(pushed.length, 1);
    assert.deepEqual(pushed[0]?.agents, [
      { id: "claude", activity: [{ source: "mac", lastActivityAt: NOW - 10_000, model: "claude-opus-5" }] },
      { id: "cursor", activity: [{ source: "agents", lastActivityAt: NOW + 30_000, model: "grok-4.7-xhigh" }] },
    ], "the whole payload, not a patch of the one row that changed");

    const again = await commit(env, await activity(NOW + 120_000, NOW + 40_000));
    assert.equal(again.effects.some((effect) => effect.kind === "event"), false);
    const switched = await commit(env, await activity(NOW + 180_000, NOW + 40_000, "composer-2"));
    assert.equal(switched.effects.some((effect) => effect.kind === "event" && effect.event.type === "coding-now"), true);

    await assert.rejects(
      inRequest(env, () => prepareIngest("agents", { collectedAt: new Date(NOW).toISOString() }, NOW)),
    );
    await assert.rejects(
      inRequest(env, () => prepareIngest("agents", { cursorNow: { lastActivityAt: new Date(NOW).toISOString(), currentModel: "x" } }, NOW)),
      "the renamed cursorNow is no longer data",
    );
  } finally { resetStorageForTests(); }
});

test("an errored Cursor history round (a strictly parsed page failed) keeps the stored days and only marks the agents source as error", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  const env = testEnv();
  const agents = (at: number, row: Record<string, unknown>) => inRequest(env, () => prepareIngest("agents", {
    collectedAt: new Date(at).toISOString(), codingUsage: { agents: [{ id: "cursor", sessionCount: null, ...row }] },
  }, at));
  try {
    assert.equal((await commit(env, await agents(NOW, { state: "ok", collectedAt: NOW, days: [usageDay("2026-09-28", 500, "composer-2")] }))).ok, true);
    const failed = await commit(env, await agents(NOW + 300_000, { state: "error", collectedAt: NOW, error: "cursor history: invalid usage event" }));
    assert.equal(failed.ok, true);
    const view = parseStoredView(await storage.get(codingViewKey()))!;
    const cursor = view.agents.find((agent) => agent.id === "cursor")!;
    assert.deepEqual(cursor.status.map((row) => [row.source, row.state, row.collectedAt, row.error]), [["agents", "error", NOW, "cursor history: invalid usage event"]]);
    assert.equal(cursor.lastDay?.totalTokens, 500, "the history is not cleared");
    assert.equal(view.totals?.totalTokens, 500);
    const { cursorObservationsKey } = await import("@/lib/coding-pulse");
    assert.equal((await storage.listRange(cursorObservationsKey(), 0, -1)).length, 1);
  } finally { resetStorageForTests(); }
});

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
  installStorageForTests(storage);
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
  } finally { resetStorageForTests(); }
});

test("an OTLP commit that fails after the delta is computed writes nothing, so the next export still lands the whole delta", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
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
  } finally { storage.failWhen(null); resetStorageForTests(); }
});

test("OTLP envelopes that commit in the opposite order of their receipt keep every delta in the ledger", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
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
  } finally { resetStorageForTests(); }
});

test("delta-temporality OTLP points are not counted, so a retry after a lost receipt cannot double count", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
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
  } finally { console.warn = previous; resetStorageForTests(); }
});

test("a status-only round patches the stored view instead of rescanning every day row", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  const env = testEnv();
  const usage = (at: number, tokens: number) => inRequest(env, () => prepareIngest("mac", envelope({ codingUsage: { agents: [
    { id: "claude", state: "ok", collectedAt: at, sessionCount: 3, days: [usageDay("2026-09-29", tokens)] },
  ] } }, ["coding"]), at));
  const view = async () => parseStoredView(await storage.get(codingViewKey()))!;
  try {
    assert.equal((await commit(env, await usage(NOW, 100))).ok, true);
    const stored = await view();
    await storage.set(codingViewKey(), JSON.stringify({ ...stored, totals: { ...stored.totals!, totalTokens: 999_999 } }));

    assert.equal((await commit(env, await usage(NOW + 600_000, 100))).ok, true);
    assert.equal((await view()).totals?.totalTokens, 999_999, "the day rows were not rescanned");
    assert.equal((await view()).agents[0]?.status[0]?.collectedAt, NOW + 600_000, "only the status moved");

    assert.equal((await commit(env, await usage(NOW + 1_200_000, 140))).ok, true);
    assert.equal((await view()).totals?.totalTokens, 140);
  } finally { resetStorageForTests(); }
});

test("a late, older usage snapshot never replaces a newer one, ok or error", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  const env = testEnv();
  const agents = (at: number, row: Record<string, unknown>) => inRequest(env, () => prepareIngest("agents", {
    collectedAt: new Date(at).toISOString(), codingUsage: { agents: [{ id: "cursor", sessionCount: null, ...row }] },
  }, at));
  const cursor = async () => parseStoredUsageLedgers(await fieldsOf(storage, codingUsageKey("agents"))).cursor;
  const total = async () => parseStoredView(await storage.get(codingViewKey()))?.totals?.totalTokens;
  const earlier = NOW;
  const later = NOW + 600_000;
  const twoDays = (last: number) => [usageDay("2026-09-28", 500, "composer-2"), usageDay("2026-09-29", last, "composer-2")];
  try {
    assert.equal((await commit(env, await agents(later, { state: "ok", collectedAt: later, days: twoDays(80) }))).ok, true);
    assert.equal((await commit(env, await agents(later + 1_000, { state: "ok", collectedAt: earlier, days: [usageDay("2026-09-28", 500, "composer-2")] }))).ok, true);
    assert.deepEqual((await cursor())?.days.map((day) => day.date), ["2026-09-28", "2026-09-29"]);
    assert.equal(await total(), 580);
    await commit(env, await agents(later + 2_000, { state: "error", collectedAt: earlier, error: "an old failure" }));
    assert.equal((await cursor())?.state, "ok");
    await commit(env, await agents(later + 3_000, { state: "error", collectedAt: later, error: "cursor history: 500" }));
    assert.equal((await cursor())?.state, "error");
    assert.equal(await total(), 580);
    await commit(env, await agents(later + 4_000, { state: "ok", collectedAt: later, days: twoDays(80) }));
    assert.equal((await cursor())?.state, "error");
    await commit(env, await agents(later + 600_000, { state: "ok", collectedAt: later + 600_000, days: twoDays(90) }));
    assert.equal((await cursor())?.state, "ok");
    assert.equal(await total(), 590);
  } finally { resetStorageForTests(); }
});

test("a usage round that only advances collectedAt updates the status without rewriting the year or moving the archive marks", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  const env = testEnv();
  const usage = (at: number, agents: unknown[]) => inRequest(env, () => prepareIngest("mac", envelope({ codingUsage: { agents } }, ["coding"]), at));
  const claude = (at: number, tokens = 100) => ({ id: "claude", state: "ok", collectedAt: at, sessionCount: 3, days: [usageDay("2026-09-29", tokens)] });
  const ledger = async () => parseStoredUsageLedgers(await fieldsOf(storage, codingUsageKey("mac"))).claude!;
  try {
    assert.equal((await commit(env, await usage(NOW, [claude(NOW)]))).ok, true);
    const year = await storage.get(codingYearKey());
    assert.ok(year);

    assert.equal((await commit(env, await usage(NOW + 600_000, [claude(NOW + 600_000)]))).ok, true);
    const view = parseStoredView(await storage.get(codingViewKey()))!;
    assert.equal(view.agents[0]?.status[0]?.collectedAt, NOW + 600_000, "the status follows the round");
    assert.equal(view.updatedAt, NOW, "the view's updatedAt (the archive's gate) stays where the days last changed");
    assert.equal((await ledger()).collectedAt, NOW + 600_000);
    assert.equal((await ledger()).receivedAt, NOW, "so does the ledger's archive mark");
    assert.equal(await storage.get(codingYearKey()), year, "the year is not rewritten");

    await commit(env, await usage(NOW + 1_200_000, [claude(NOW + 1_200_000, 140)]));
    assert.equal(parseStoredView(await storage.get(codingViewKey()))?.updatedAt, NOW + 1_200_000);
    assert.equal((await ledger()).receivedAt, NOW + 1_200_000);
    assert.notEqual(await storage.get(codingYearKey()), year);
  } finally { resetStorageForTests(); }
});

test("coding-now pushes are gated against the last pushed payload, so a steady 30-second cadence still pushes about once a minute", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  const env = testEnv();
  const activity = (at: number) => inRequest(env, () => prepareIngest("agents", {
    collectedAt: new Date(at).toISOString(),
    codingActivity: { collectedAt: at, agents: [{ id: "cursor", lastActivityAt: at - 5_000, model: "composer-2" }] },
  }, at));
  const pushed = (result: CollectedIngest<unknown>) =>
    result.effects.some((effect) => effect.kind === "event" && effect.event.type === "coding-now");
  try {
    const step = async (index: number) => pushed(await commit(env, await activity(NOW + index * 30_000)));
    const steps = [await step(0), await step(1), await step(2), await step(3), await step(4)];
    assert.deepEqual(steps, [true, false, true, false, true]);
  } finally { resetStorageForTests(); }
});

test("desktop icon commits merge the latest map without losing another report", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  const env = testEnv();
  try {
    const make = (name: string, iconHash: string, objectKey: string, at: number) =>
      inRequest(env, () => prepareIngest("mac", envelope({ desktop: {
        applicationName: name,
        iconHash,
        iconObjectKey: objectKey,
        observedAt: at,
      } }, ["desktop"]), at));
    const first = await make("First", HASH_A, `${HASH_A}.webp`, NOW);
    const second = await make("Second", HASH_B, `${HASH_B}.webp`, NOW + 1);
    assert.equal((await commit(env, first)).ok, true);
    assert.equal((await commit(env, second)).ok, true);
    assert.deepEqual((await telemetryMirror.get())?.desktopIconAssets, [
      [HASH_A, `${HASH_A}.webp`],
      [HASH_B, `${HASH_B}.webp`],
    ]);
  } finally { resetStorageForTests(); }
});

function trophiesReport(observedAt: number, earned: boolean) {
  const counts = (bronze: number) => ({ platinum: 0, gold: 0, silver: 0, bronze });
  return {
    observedAt,
    profile: {
      onlineId: "tester", avatarUrl: null, plus: false, level: 1, tier: 1,
      trophyPoint: 0, levelBasePoint: 0, levelNextPoint: 60, levelProgress: 0,
      earned: counts(earned ? 1 : 0),
    },
    titles: [{
      npCommunicationId: "NPWR00001_00", name: "Game", localizedName: null,
      titleIds: ["PPSA00001_00"], iconUrl: null, platform: "PS5",
      progress: earned ? 100 : 0, defined: counts(1), earned: counts(earned ? 1 : 0),
      lastUpdatedAt: earned ? observedAt : null, playDurationMs: null, playCount: 1,
      firstPlayedAt: null, lastPlayedAt: null, service: null, preOrder: false,
      groups: [{
        id: "default", name: "Game", iconUrl: null, progress: earned ? 100 : 0,
        defined: counts(1), earned: counts(earned ? 1 : 0),
      }],
      trophies: [{
        id: 0, type: "bronze", name: "First", detail: null, iconUrl: null, hidden: false,
        groupId: "default", earned, earnedAt: earned ? observedAt : null, earnedRate: 50,
      }],
    }],
  };
}

test("PlayStation trophies push the summary only when the catalog content changes", async () => {
  installStorageForTests(new FakeStorage());
  const env = testEnv();
  const ingest = async (observedAt: number, earned: boolean) => commit(env, await inRequest(env, () =>
    prepareIngest("playstation", { version: 1, trophies: trophiesReport(observedAt, earned) }, observedAt)));
  const pushed = (result: CollectedIngest<unknown>) => result.effects.flatMap((effect) =>
    effect.kind === "event" && effect.event.type === "trophies" ? [effect.event.payload] : []);
  try {
    assert.equal(pushed(await ingest(NOW, false)).length, 1);
    assert.deepEqual(pushed(await ingest(NOW + 60_000, false)), []);

    const [summary] = pushed(await ingest(NOW + 120_000, true));
    assert.ok(summary);
    assert.equal(Object.hasOwn(summary.titles[0]!, "trophies"), false);
    assert.deepEqual(summary.earned, { platinum: 0, gold: 0, silver: 0, bronze: 1 });
    assert.equal(summary.recent[0]?.trophyName, "First");
  } finally { resetStorageForTests(); }
});

test("listening effects retain the track from their own commit", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  const env = testEnv();
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = (async () => {
    fetches += 1;
    throw new Error("network called during commit");
  }) as typeof fetch;
  try {
    const make = (title: string, at: number) => inRequest(env, () => prepareIngest("mac", envelope({
      appleMusic: { state: "playing", title, artist: "Artist", observedAt: at },
    }, ["appleMusic"]), at));
    const first = await make("First", NOW);
    const second = await make("Second", NOW + 1);
    const firstResult = await commit(env, first);
    const secondResult = await commit(env, second);
    assert.equal(firstResult.ok, true);
    assert.equal(secondResult.ok, true);
    const title = (result: CollectedIngest<unknown>) => result.effects.find(
      (effect) => effect.kind === "listening",
    )?.kind === "listening"
      ? result.effects.find((effect) => effect.kind === "listening")!.mac?.music?.title
      : null;
    assert.equal(title(firstResult), "First");
    assert.equal(title(secondResult), "Second");
    assert.equal(fetches, 0);
    let broadcasts = 0;
    const dispatchEnv = {
      ...env,
      LIVE_PUSH: {
        idFromName: () => null,
        get: () => ({ broadcast: async () => { broadcasts += 1; } }),
      },
    } as unknown as Env;
    await inRequest(dispatchEnv, () => dispatchIngestEffects(firstResult.effects));
    assert.equal(broadcasts, 1);
  } finally {
    globalThis.fetch = originalFetch;
    resetStorageForTests();
  }
});

test("StateCore enrichment is stored with the track and the push reads it without network", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  const kv = new MemoryKv();
  installAppleCacheForTests(kv);
  const env = testEnv();
  const link = "https://music.apple.com/cn/album/x/1500?i=1501";
  kv.values.set(`lyjwpage:${trackLookupCacheKey({ title: "First", artist: "Artist", album: null })}`,
    JSON.stringify({ link, artwork: null, id: "1500", songId: "1501", hasLyrics: false }));
  kv.values.set(`lyjwpage:${motionArtworkCacheKey(parseAppleMusicUrl(link)!)}`,
    JSON.stringify({ hasMotion: true, videoUrl: "https://mvod/x.m3u8", colors: null }));
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = (async () => {
    fetches += 1;
    throw new Error("network disabled");
  }) as typeof fetch;
  try {
    const prepared = await inRequest(env, () => prepareIngest("mac", envelope({
      appleMusic: { state: "playing", title: "First", artist: "Artist", observedAt: NOW },
    }, ["appleMusic"]), NOW));
    const { command: enriched } = await inRequest(env, () => enrichCommand(prepared));
    const result = await commit(env, enriched);
    assert.equal(result.ok, true);
    const stored = await inRequest(env, () => telemetryMirror.get());
    assert.equal(stored?.musicEnrichment?.songId, "1501");
    const messages: string[] = [];
    const dispatchEnv = {
      ...env,
      LIVE_PUSH: { idFromName: () => null, get: () => ({ broadcast: async (message: string) => { messages.push(message); } }) },
    } as unknown as Env;
    await inRequest(dispatchEnv, () => dispatchIngestEffects(result.effects));
    const event = JSON.parse(messages[0]!) as { type: string; payload: { songId: string; motion: unknown } };
    assert.equal(event.type, "listening-now");
    assert.equal(event.payload.songId, "1501");
    assert.deepEqual(event.payload.motion, { videoUrl: "https://mvod/x.m3u8", colors: null });
    assert.equal(fetches, 0);
  } finally {
    globalThis.fetch = originalFetch;
    installAppleCacheForTests(null);
    resetStorageForTests();
  }
});

test("commit performs no room or Vercel I/O and Worker dispatch performs both", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  let broadcasts = 0;
  let revalidates = 0;
  const env = {
    ...testEnv(),
    SITE_URL: "https://site.example",
    REVALIDATE_SECRET: "secret",
    LIVE_PUSH: {
      idFromName: () => null,
      get: () => ({ broadcast: async () => { broadcasts += 1; } }),
    },
  } as unknown as Env;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    if (String(input) === "https://site.example/api/revalidate") {
      revalidates += 1;
      return Response.json({ ok: true });
    }
    throw new Error(`unexpected fetch ${String(input)}`);
  }) as typeof fetch;
  try {
    const command = await inRequest(env, () => prepareIngest("mac", envelope({
      chargingDevices: { devices: [
        { id: "charger", kind: "charger", connected: true, updatedAt: NOW, totalOutputW: 40 },
      ] },
    }, ["charger"]), NOW));
    const result = await commit(env, command);
    assert.equal(result.ok, true);
    assert.equal(broadcasts, 0);
    assert.equal(revalidates, 0);
    await inRequest(env, () => dispatchIngestEffects(result.effects));
    assert.equal(broadcasts, 1);
    assert.equal(revalidates, 1);
  } finally {
    globalThis.fetch = originalFetch;
    resetStorageForTests();
  }
});


function desktopPush(result: CollectedIngest<unknown>) {
  const effect = result.effects.find(
    (item) => item.kind === "event" && item.event.type === "desktop",
  );
  if (!(effect?.kind === "event" && effect.event.type === "desktop")) {
    throw new Error("没有推送 desktop 事件");
  }
  const { desktop } = effect.event.payload;
  if (!desktop) throw new Error("desktop 推送里没有前台应用");
  return desktop;
}

async function landDesktop(env: Env, desktop: Record<string, unknown>) {
  const command = await inRequest(env, () =>
    prepareIngest("mac", envelope({ desktop }, ["desktop"]), NOW));
  const result = await commit(env, command);
  return { command, result };
}

test("desktop 的窗口标题入库并随推送发出", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  const env = testEnv();
  try {
    const { result } = await landDesktop(env, {
      applicationName: "Ghostty",
      bundleIdentifier: "com.mitchellh.ghostty",
      windowTitle: "  ~/Developer/lyjwpage — zsh  ",
      observedAt: NOW,
    });
    assert.equal(result.ok, true);
    assert.equal((await telemetryMirror.get())?.desktop?.windowTitle, "~/Developer/lyjwpage — zsh");
    assert.equal(desktopPush(result).windowTitle, "~/Developer/lyjwpage — zsh");
  } finally { resetStorageForTests(); }
});

test("desktop 缺席或空白的窗口标题一律是 null，不是缺字段", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  const env = testEnv();
  try {
    const blank = await landDesktop(env, {
      applicationName: "Ghostty",
      windowTitle: "   ",
      observedAt: NOW,
    });
    assert.equal(blank.result.ok, true);
    assert.equal((await telemetryMirror.get())?.desktop?.windowTitle, null);
    const blankPush = desktopPush(blank.result);
    assert.equal(blankPush.windowTitle, null);
    assert.ok("windowTitle" in blankPush);

    const absent = await landDesktop(env, { applicationName: "Ghostty", observedAt: NOW + 1 });
    assert.equal(absent.result.ok, true);
    assert.equal((await telemetryMirror.get())?.desktop?.windowTitle, null);
    const absentPush = desktopPush(absent.result);
    assert.equal(absentPush.windowTitle, null);
    assert.ok("windowTitle" in absentPush);
  } finally { resetStorageForTests(); }
});

test("desktop 的超长窗口标题按码点截断，不劈开代理对", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  const env = testEnv();
  try {
    const { result } = await landDesktop(env, {
      applicationName: "Ghostty",
      windowTitle: "🎬".repeat(250),
      observedAt: NOW,
    });
    assert.equal(result.ok, true);
    const stored = (await telemetryMirror.get())?.desktop?.windowTitle;
    assert.equal(stored, "🎬".repeat(200));
    assert.equal([...(stored ?? "")].length, 200);
    assert.equal(desktopPush(result).windowTitle, stored);

    const exact = await landDesktop(env, {
      applicationName: "Ghostty",
      windowTitle: "标".repeat(200),
      observedAt: NOW + 1,
    });
    assert.equal((await telemetryMirror.get())?.desktop?.windowTitle, "标".repeat(200));
    assert.equal(desktopPush(exact.result).windowTitle, "标".repeat(200));
  } finally { resetStorageForTests(); }
});

test("desktop 的窗口标题类型不对时该模块及其后的模块都不落地", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  const env = testEnv();
  try {
    const { command, result } = await landDesktop(env, {
      applicationName: "Ghostty",
      windowTitle: 42,
      observedAt: NOW,
    });
    assert.equal((command as PreparedTelemetryEnvelope).failure?.stage, "beforeDesktop");
    assert.equal(result.ok, false);
    assert.equal(await telemetryMirror.get(), null);
    assert.equal(result.effects.some((effect) =>
      effect.kind === "event" && effect.event.type === "desktop"), false);
  } finally { resetStorageForTests(); }
});

test("隐藏前台应用时窗口标题被强制清空", async () => {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  const env = testEnv();
  try {
    const { result } = await landDesktop(env, {
      applicationName: "Hidden",
      bundleIdentifier: HIDDEN_DESKTOP_BUNDLE_ID,
      windowTitle: "私密项目 — 不该出现在站点上",
      observedAt: NOW,
    });
    assert.equal(result.ok, true);
    assert.equal((await telemetryMirror.get())?.desktop?.windowTitle, null);
    assert.equal(desktopPush(result).windowTitle, null);
  } finally { resetStorageForTests(); }
});
