import assert from "node:assert/strict";
import test from "node:test";

import { codingObservationsKey, cursorObservationsKey } from "@/lib/coding-pulse";
import { getPulseStatus } from "@/lib/pulse";
import { pulseAssessmentsKey } from "@/lib/pulse-assessments";
import { columnRows } from "@/lib/pulse-columns";
import {
  pulseActivityKey,
  pulseChargingKey,
  pulseLaneKey,
  pulseLaneOpenKey,
  pulseListeningTracesKey,
  pulseWorkoutsKey,
} from "@/lib/pulse-keys";
import { installStorageForTests, resetStorageForTests } from "@/lib/storage";
import { FakeStorage } from "@/lib/testing/fake-storage";
import type { PulseAssessment } from "@shared/pulse-assessment";

const NOW = 1_800_000_000_000;
const FROM = NOW - 24 * 3_600_000;
const M = 60_000;
const sec = (at: number) => Math.round((at - FROM) / 1000);

async function withStorage(run: (storage: FakeStorage) => Promise<void>) {
  const storage = new FakeStorage();
  installStorageForTests(storage);
  try { await run(storage); } finally { resetStorageForTests(); }
}

test("empty storage is an all-unknown timeline, not an error", async () => {
  await withStorage(async () => {
    const payload = await getPulseStatus(NOW);
    assert.deepEqual(payload.window, { from: FROM, to: NOW });
    assert.deepEqual(payload.lanes.listening.segments, { startSec: [], endSec: [], state: [], title: [], subtitle: [] });
    assert.deepEqual(payload.lanes.listening.uncertain, { startSec: [], endSec: [], title: [], subtitle: [] });
    assert.equal(payload.lanes.charging.currentPowerW, null);
    assert.deepEqual(payload.lanes.coding.summary, { humanSeconds: 0, agentSeconds: 0, bothSeconds: 0 });
  });
});

test("coding band shows human, agent and both from raw observations; app and model names never leave", async () => {
  await withStorage(async (storage) => {
    const obs = (t: number, coding: boolean, active: boolean) => JSON.stringify({
      t, available: true, desktop: { application: "SecretEditor", coding }, agents: [{ id: "claude", model: "secret-model", active }],
    });
    await storage.append(codingObservationsKey(),
      obs(NOW - 60 * M, true, false), obs(NOW - 58 * M, true, true), obs(NOW - 56 * M, false, true),
      JSON.stringify({ t: NOW - 54 * M, available: false, desktop: null, agents: null }));
    // Mac 离线后 Cursor 账号那一路仍看得见，最近的活动算 agent
    await storage.append(cursorObservationsKey(), JSON.stringify({ t: NOW - 30 * M, available: true, lastActivityAt: NOW - 30 * M }));
    const scored: PulseAssessment = { domain: "coding", from: NOW - 60 * M, to: NOW - 45 * M, coverage: [{ from: NOW - 60 * M, to: NOW - 54 * M }],
      intensity: { value: 3, confidence: 0.876, probabilities: { 0: 0, 1: 0, 2: 0, 3: 1, 4: 0 } },
      continuity: { value: 2, confidence: 1, probabilities: { 0: 0, 1: 0, 2: 1, 3: 0 } },
      mode: { value: "mixed", confidence: 1, probabilities: { idle: 0, brief: 0, interactive: 0, agent: 0, mixed: 1 } },
      model: "jev-1.13.0", scoredAt: NOW, inputHash: "h" };
    await storage.append(pulseAssessmentsKey(), JSON.stringify(scored), JSON.stringify({ ...scored, domain: "listening" }));
    const { coding } = (await getPulseStatus(NOW)).lanes;
    assert.deepEqual(columnRows(coding.segments, ["value"]), [
      { startSec: sec(NOW - 60 * M), endSec: sec(NOW - 58 * M), value: 1 },
      { startSec: sec(NOW - 58 * M), endSec: sec(NOW - 56 * M), value: 3 },
      { startSec: sec(NOW - 56 * M), endSec: sec(NOW - 54 * M), value: 2 },
      { startSec: sec(NOW - 30 * M), endSec: sec(NOW - 25 * M), value: 2 },
      { startSec: sec(NOW - 25 * M), endSec: sec(NOW), value: 0 },
    ]);
    assert.deepEqual(coding.summary, { humanSeconds: 120, agentSeconds: 420, bothSeconds: 120 });
    assert.deepEqual(coding.assessments, { startSec: [sec(NOW - 60 * M)], endSec: [sec(NOW - 45 * M)], intensity: [3], confidence: [0.88], mode: ["mixed"] });
    const wire = JSON.stringify(coding);
    assert.equal(wire.includes("SecretEditor") || wire.includes("secret-model") || wire.includes("claude"), false);
  });
});

test("state lanes keep unknown apart from idle, expose titles only while active, and draw traces the Mac cannot explain", async () => {
  await withStorage(async (storage) => {
    const music = (state: string, title: string | null, album: string | null) => ({ state, source: state === "idle" ? null : "mac", title, artist: title && "Hamilton", album, trackId: null });
    await storage.append(pulseLaneKey("listening"),
      JSON.stringify({ ...music("playing", "Helpless", "Hamilton"), from: NOW - 120 * M, to: NOW - 100 * M }),
      JSON.stringify({ ...music("paused", "Helpless", "Hamilton"), from: NOW - 100 * M, to: NOW - 90 * M }),
      JSON.stringify({ ...music("idle", null, null), from: NOW - 90 * M, to: NOW - 80 * M }));
    await storage.set(pulseLaneOpenKey("listening"), JSON.stringify({ ...music("playing", "Satisfied", "Hamilton"), from: NOW - 20 * M, seenAt: NOW - M }));
    await storage.append(pulseListeningTracesKey(),
      JSON.stringify({ since: NOW - 115 * M, t: NOW - 113 * M, title: "Hamilton", artist: "Lin-Manuel Miranda", itemId: "1" }),
      JSON.stringify({ since: NOW - 60 * M, t: NOW - 58 * M, title: "THE BOOK 3", artist: "YOASOBI", itemId: "2" }));
    const { listening } = (await getPulseStatus(NOW)).lanes;
    assert.deepEqual(columnRows(listening.segments, ["state", "title", "subtitle"]), [
      { startSec: sec(NOW - 120 * M), endSec: sec(NOW - 100 * M), state: 2, title: "Helpless", subtitle: "Hamilton" },
      { startSec: sec(NOW - 100 * M), endSec: sec(NOW - 90 * M), state: 1, title: "Helpless", subtitle: "Hamilton" },
      { startSec: sec(NOW - 90 * M), endSec: sec(NOW - 80 * M), state: 0, title: null, subtitle: null },
      { startSec: sec(NOW - 20 * M), endSec: sec(NOW), state: 2, title: "Satisfied", subtitle: "Hamilton" },
    ], "80–20 minutes ago has no segment: unknown");
    assert.deepEqual(columnRows(listening.uncertain!, ["title", "subtitle"]), [
      { startSec: sec(NOW - 60 * M), endSec: sec(NOW - 58 * M), title: "THE BOOK 3", subtitle: "YOASOBI" },
    ], "a trace already explained by the Mac playing that album is not drawn twice");
    assert.deepEqual(listening.summary, { activeSeconds: 40 * 60, titles: 2 });

    await storage.set(pulseLaneOpenKey("gaming"), JSON.stringify({ state: "online", titleId: null, title: null, from: NOW - 50 * M, seenAt: NOW - 30 * M }));
    const { gaming } = (await getPulseStatus(NOW)).lanes;
    assert.deepEqual(columnRows(gaming.segments, ["state", "title"]), [{ startSec: sec(NOW - 50 * M), endSec: sec(NOW), state: 1, title: null }],
      "PSN's 35-minute hold keeps a 30-minute-old confirmation current");
  });
});

test("charging draws measured watts with outages left empty; activity exposes step buckets and workouts", async () => {
  await withStorage(async (storage) => {
    await storage.append(pulseChargingKey(),
      JSON.stringify({ t: NOW - 60 * M, watts: 0 }),
      JSON.stringify({ t: NOW - 50 * M, watts: 65, device: "Private MacBook" }),
      JSON.stringify({ t: NOW - 45 * M, watts: 30, device: "Private MacBook" }));
    await storage.append(pulseActivityKey(),
      JSON.stringify({ from: FROM - 2 * M, to: FROM + 3 * M, steps: 500, moveKcal: 1, exerciseMinutes: null }),
      JSON.stringify({ from: NOW - 30 * M, to: NOW - 25 * M, steps: 812, moveKcal: 20, exerciseMinutes: 5 }),
      JSON.stringify({ from: NOW - 25 * M, to: NOW - 20 * M, steps: null, moveKcal: 3, exerciseMinutes: 0 }));
    await storage.set(pulseWorkoutsKey(), JSON.stringify({ items: [{ startedAt: NOW - 40 * M, endedAt: NOW - 20 * M, activityType: "Fencing" }] }));
    const { charging, activity } = (await getPulseStatus(NOW)).lanes;
    assert.deepEqual(columnRows(charging.segments, ["watts"]), [
      { startSec: sec(NOW - 60 * M), endSec: sec(NOW - 50 * M), watts: 0 },
      { startSec: sec(NOW - 50 * M), endSec: sec(NOW - 45 * M), watts: 65 },
      { startSec: sec(NOW - 45 * M), endSec: sec(NOW - 35 * M), watts: 30 },
    ]);
    assert.equal(charging.currentPowerW, null);
    assert.deepEqual(charging.summary, { peakW: 65, energyWh: 10.4 });
    assert.equal(JSON.stringify(charging).includes("Private"), false);
    assert.deepEqual(columnRows(activity.buckets, ["steps"]), [
      { startSec: 0, endSec: 180, steps: 500 },
      { startSec: sec(NOW - 30 * M), endSec: sec(NOW - 25 * M), steps: 812 },
    ], "buckets without a step count stay unknown");
    assert.deepEqual(activity.summary, { steps: 300 + 812 });
    assert.deepEqual(columnRows(activity.workouts, ["activityType"]), [{ startSec: sec(NOW - 40 * M), endSec: sec(NOW - 20 * M), activityType: "Fencing" }]);
  });
});

test("column rows reject a payload from another deploy instead of throwing", () => {
  type StateColumns = { startSec: number[]; endSec: number[]; state: number[] };
  assert.equal(columnRows({ startSec: [1], endSec: [2] } as unknown as StateColumns, ["state"]), null);
  assert.equal(columnRows<StateColumns>({ startSec: [1, 2], endSec: [2], state: [0, 1] }, ["state"]), null);
  assert.equal(columnRows<StateColumns>(undefined, ["state"]), null);
  assert.deepEqual(columnRows<StateColumns>({ startSec: [], endSec: [], state: [] }, ["state"]), []);
});
