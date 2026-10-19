import assert from "node:assert/strict";
import test from "node:test";

import { readLiveness } from "@shared/reporter-liveness";
import { FakeStorage, installTestStorage } from "@shared/testing/fake-storage";
import {
  codingActivityKey,
  codingUsageKey,
  codingViewKey,
  codingYearKey,
  parseStoredActivity,
  parseStoredUsageLedgers,
  parseStoredView,
} from "@shared/coding-store";
import { mirror as telemetryMirror } from "@shared/telemetry";

import { type CollectedIngest } from "./ingest-effects";
import { prepareIngest as prepareShared, type CoreCommand } from "@shared/ingest/prepare";
import { type ImageBucket } from "@shared/ingest/r2-assets";
import type { PreparedTelemetryEnvelope } from "@shared/ingest/telemetry";
import { NOW, commit, envelope, fieldsOf, inRequest, testEnv, usageDay } from "./testing/ingest-harness";

function prepareIngest(source: string, body: unknown, at: number, images: ImageBucket = { head: async () => ({}) }): Promise<CoreCommand> {
  return prepareShared(source, body, at, images) as Promise<CoreCommand>;
}

test("a broken coding module is dropped at the ingress; desktop, liveness and the other coding modules still commit", async () => {
  const storage = new FakeStorage();
  installTestStorage(storage);
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
  } finally { installTestStorage(null); }
});

test("Mac usage replaces its ledgers, recomputes the view and tags the first screen only when the skeleton changes", async () => {
  const storage = new FakeStorage();
  installTestStorage(storage);
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
  } finally { installTestStorage(null); }
});

test("Cursor activity-only agents envelopes push the whole coding-now payload, and only when it moved", async () => {
  const storage = new FakeStorage();
  installTestStorage(storage);
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
  } finally { installTestStorage(null); }
});

test("an errored Cursor history round (a strictly parsed page failed) keeps the stored days and only marks the agents source as error", async () => {
  const storage = new FakeStorage();
  installTestStorage(storage);
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
    const { cursorObservationsKey } = await import("./coding-pulse");
    assert.equal((await storage.listRange(cursorObservationsKey(), 0, -1)).length, 1);
  } finally { installTestStorage(null); }
});

test("a status-only round patches the stored view instead of rescanning every day row", async () => {
  const storage = new FakeStorage();
  installTestStorage(storage);
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
  } finally { installTestStorage(null); }
});

test("a late, older usage snapshot never replaces a newer one, ok or error", async () => {
  const storage = new FakeStorage();
  installTestStorage(storage);
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
  } finally { installTestStorage(null); }
});

test("a usage round that only advances collectedAt updates the status without rewriting the year or moving the archive marks", async () => {
  const storage = new FakeStorage();
  installTestStorage(storage);
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
  } finally { installTestStorage(null); }
});

test("coding-now pushes are gated against the last pushed payload, so a steady 30-second cadence still pushes about once a minute", async () => {
  const storage = new FakeStorage();
  installTestStorage(storage);
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
  } finally { installTestStorage(null); }
});
