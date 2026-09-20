import assert from "node:assert/strict";
import test from "node:test";
import { normalizeWorkouts, writeWorkouts } from "@api/stores/workouts";
import { getWorkoutsSnapshot } from "@/lib/workouts";
import { installStorageForTests, resetStorageForTests } from "@/lib/storage";
import { FakeStorage } from "@/lib/testing/fake-storage";
import { withRequestState } from "@shared/request-state";
import { recordPhoneEnvelope } from "@api/phone-telemetry";
import { requestStore, type Env } from "@api/runtime";
import { loadEndpoint } from "@/lib/status-loaders";
import { viewKeyByPath } from "@/lib/status-views";

const now = 1_790_000_000_000;
const workout = {
  id: "11111111-1111-4111-8111-111111111111", activityType: "Running",
  startedAt: now - 3600_000, endedAt: now - 1800_000,
  durationSeconds: 1500, secondsFromGMT: 28800,
};

test("workouts sort completed sessions, preserve active duration and unknown metrics", () => {
  const older = { ...workout, id: "22222222-2222-4222-8222-222222222222", startedAt: now - 7200_000, endedAt: now - 5400_000, distanceMeters: 0 };
  const result = normalizeWorkouts({ items: [older, workout] }, now);
  assert.equal(result.items[0].id, workout.id);
  assert.equal(result.items[0].durationSeconds, 1500);
  assert.equal(result.items[0].distanceMeters, null);
  assert.equal(result.items[0].activeEnergyKcal, null);
  assert.equal(result.items[1].distanceMeters, 0);
  assert.equal(result.pushedAt, now);
});

test("workouts reject malformed histories, timestamps, duplicate ids and numeric values", () => {
  for (const input of [null, {}, { items: {} }, { items: Array(11).fill(workout) }, { items: [workout, workout] }]) {
    assert.throws(() => normalizeWorkouts(input, now));
  }
  for (const patch of [{ endedAt: now + 3600_000 }, { startedAt: now }, { durationSeconds: 4000 }, { distanceMeters: -1 }, { activeEnergyKcal: Infinity }, { durationSeconds: "1500" }, { secondsFromGMT: 999999 }, { id: "bad" }, { averageHeartRateBpm: 0 }, { averageHeartRateBpm: 150, maximumHeartRateBpm: 140 }, { indoor: "false" }, { elevationAscendedMeters: -1 }]) {
    assert.throws(() => normalizeWorkouts({ items: [{ ...workout, ...patch }] }, now));
  }
});

test("iPhone ingest exposes workouts through the public loader and replaces deleted history", async () => {
  resetStorageForTests();
  installStorageForTests(new FakeStorage());
  const pending: Promise<unknown>[] = [];
  try {
    await requestStore.run({ env: {} as Env, ctx: { waitUntil: (p) => { pending.push(p); } } }, () => withRequestState(async () => {
      await assert.rejects(getWorkoutsSnapshot, /Awaiting/);
      assert.deepEqual(await recordPhoneEnvelope({ version: 1, modules: { workouts: { items: [workout] } } }, now), { accepted: 1, ignored: [] });
      assert.equal(viewKeyByPath("/api/status/workouts"), "workouts");
      assert.deepEqual(await loadEndpoint("workouts"), normalizeWorkouts({ items: [workout] }, now));
      await writeWorkouts(normalizeWorkouts({ items: [] }, now + 1000));
      assert.deepEqual((await getWorkoutsSnapshot()).items, []);
    }));
    await Promise.allSettled(pending);
  } finally { resetStorageForTests(); }
});

test("workouts retain measured heart rate, environment and elevation without inventing absent values", () => {
  const detailed = { ...workout, averageHeartRateBpm: 150.85, maximumHeartRateBpm: 170, elevationAscendedMeters: 16.3, indoor: false };
  const item = normalizeWorkouts({ items: [detailed] }, now).items[0];
  assert.equal(item.averageHeartRateBpm, 150.85);
  assert.equal(item.maximumHeartRateBpm, 170);
  assert.equal(item.elevationAscendedMeters, 16.3);
  assert.equal(item.indoor, false);
  const absent = normalizeWorkouts({ items: [workout] }, now).items[0];
  assert.equal(absent.averageHeartRateBpm, null);
  assert.equal(absent.elevationAscendedMeters, null);
  assert.equal(absent.indoor, null);
});
