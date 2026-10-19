import assert from "node:assert/strict";
import test from "node:test";

import { readChargerState } from "./charger-store";
import { readLiveness } from "@shared/reporter-liveness";
import { FakeStorage, installTestStorage } from "@shared/testing/fake-storage";
import { pulseWorkoutsKey } from "./pulse-keys";
import { K_LAST_PUSH } from "@shared/charger-store";
import {
  codingActivityKey,
} from "@shared/coding-store";
import { mirror as telemetryMirror } from "@shared/telemetry";

import { fanout } from "./fanout";
import { collectIngestEffects, dispatchIngestEffects } from "./ingest-effects";
import { prepareIngest as prepareShared, type CoreCommand } from "@shared/ingest/prepare";
import { type ImageBucket } from "@shared/ingest/r2-assets";
import { type Env } from "./runtime";
import { NOW, commit, envelope, inRequest, testEnv } from "./testing/ingest-harness";

function prepareIngest(source: string, body: unknown, at: number, images: ImageBucket = { head: async () => ({}) }): Promise<CoreCommand> {
  return prepareShared(source, body, at, images) as Promise<CoreCommand>;
}

test("Mac late validation keeps liveness but does not invent a charger heartbeat", async () => {
  const storage = new FakeStorage();
  installTestStorage(storage);
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
  } finally { installTestStorage(null); }
});

test("Mac commits the charger before a later malformed power bank and omits later modules", async () => {
  const storage = new FakeStorage();
  installTestStorage(storage);
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
  } finally { installTestStorage(null); }
});

test("Mac keeps an earlier charger write when desktop validation fails and does not commit later coding", async () => {
  const storage = new FakeStorage();
  installTestStorage(storage);
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
  } finally { installTestStorage(null); }
});

test("a later Mac module failure does not notify an unpersisted telemetry patch", async () => {
  const storage = new FakeStorage();
  installTestStorage(storage);
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
  } finally { installTestStorage(null); }
});

test("iPhone keeps the Pulse workout copy when the following activity module is invalid", async () => {
  const storage = new FakeStorage();
  installTestStorage(storage);
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
  } finally { installTestStorage(null); }
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

test("commit performs no room or site-cache I/O and Worker dispatch performs both", async () => {
  const storage = new FakeStorage();
  installTestStorage(storage);
  let broadcasts = 0;
  let revalidates = 0;
  const env = {
    ...testEnv(),
    SITE_CACHE: { invalidate: async (tags: readonly string[]) => { assert.ok(tags.length); revalidates += 1; } },
    LIVE_PUSH: {
      idFromName: () => null,
      get: () => ({ broadcast: async () => { broadcasts += 1; } }),
    },
  } as unknown as Env;
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
    installTestStorage(null);
  }
});
