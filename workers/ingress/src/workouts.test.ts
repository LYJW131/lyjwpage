import assert from "node:assert/strict";
import test from "node:test";
import { getWorkoutsSnapshot } from "@/lib/workouts";
import { MemoryKv } from "@/lib/testing/memory-kv";
import { viewKeyByPath } from "@/lib/status-views";
import { prepareIngest } from "@shared/ingest/prepare";
import { normalizeWorkouts } from "@shared/ingest/workouts";
import { readLag } from "@shared/lag";
import { installLagStoreForTests } from "../../../src/lib/lag-store.ts";

import { commitLagIngest } from "./lag-ingest";

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

test("iPhone ingest exposes workouts through the lag layer and replaces deleted history", async () => {
  // node --test 把 @/lib/lag-store 解析到站点那份（可注入），api Worker 打包时才换成读 env.LAG 的实现
  const kv = new MemoryKv();
  installLagStoreForTests((key) => readLag(kv, key));
  // 只走上报入口这一半：训练列表是可滞后层的快照，状态核心那份 Pulse 区间见 api 的 pulse-ingest.test
  const land = async (items: unknown[], at: number) =>
    commitLagIngest(kv, await prepareIngest("iphone", { version: 1, modules: { workouts: { items } } }, at));
  try {
    await assert.rejects(getWorkoutsSnapshot, /Awaiting/);
    assert.deepEqual(await land([workout], now), ["workouts"], "first list: the strip changes shape");
    assert.equal(viewKeyByPath("/api/status/workouts"), "workouts");
    const loaded = await getWorkoutsSnapshot();
    assert.deepEqual(loaded.data, normalizeWorkouts({ items: [workout] }, now));
    assert.equal(loaded.updatedAt, now);
    assert.deepEqual(await land([workout], now + 500), [], "same shape: content only");
    assert.deepEqual(await land([], now + 1000), ["workouts"], "emptied: another placeholder");
    assert.deepEqual((await getWorkoutsSnapshot()).data, { items: [], pushedAt: now + 1000 });
  } finally { installLagStoreForTests(null); }
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
