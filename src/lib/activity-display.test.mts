import assert from "node:assert/strict";
import test from "node:test";

import { activityDayCount, activityDistanceKm } from "./activity-display.ts";

test("a new day resets reported counts to zero and leaves missing samples blank", () => {
  assert.equal(activityDayCount(true, 1_156), 1_156);
  assert.equal(activityDayCount(false, 1_156), 0);
  assert.equal(activityDayCount(true, null), null);
  assert.equal(activityDayCount(false, null), null);
  assert.equal(activityDayCount(true, Number.NaN), null);
});

test("distance stays in kilometers with two decimals, including a reset day", () => {
  assert.equal(activityDistanceKm(true, 860), "0.86 km");
  assert.equal(activityDistanceKm(true, 4_100), "4.10 km");
  assert.equal(activityDistanceKm(false, 4_100), "0.00 km");
  assert.equal(activityDistanceKm(true, null), null);
  assert.equal(activityDistanceKm(true, 1_234_567), "1,234.57 km");
});
