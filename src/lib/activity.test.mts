import assert from "node:assert/strict";
import test from "node:test";

import { getActivitySnapshot } from "@/lib/activity";
import { localDate } from "@/lib/freshness";
import { installLagStoreForTests } from "@/lib/lag-store";
import { LAG_KEYS, type LagEntry } from "@shared/lag";

const rings = {
  secondsFromGMT: 28_800,
  moveKcal: 320, moveGoalKcal: 400, exerciseMinutes: 12, exerciseGoalMinutes: 30,
  standHours: 6, standGoalHours: 12, steps: 5_400, distanceMeters: 4_100, flightsClimbed: 3,
};

test("activity reads the rings from the lag layer: pushedAt is updatedAt and the date boundary is judged at read time", async (t) => {
  const updatedAt = Date.now() - 60_000;
  let entry: LagEntry<unknown> | null = null;
  installLagStoreForTests(async (key) => (key === LAG_KEYS.activity ? entry : null));
  t.after(() => installLagStoreForTests(null));

  await assert.rejects(getActivitySnapshot, /尚未收到活动圆环上报/);
  entry = { updatedAt, data: { ...rings, date: localDate(Date.now(), rings.secondsFromGMT) } };
  const today = await getActivitySnapshot();
  assert.equal(today.updatedAt, updatedAt);
  assert.equal(today.data.pushedAt, updatedAt);
  assert.equal(today.data.currentAtSource, true);
  assert.equal(today.data.moveKcal, 320);

  entry = { updatedAt, data: { ...rings, date: "2020-01-01" } };
  assert.equal((await getActivitySnapshot()).data.currentAtSource, false, "yesterday's rings are not today's");
});
