import test from "node:test";
import assert from "node:assert/strict";
import { workoutDuration, workoutMetrics } from "./workout-display.ts";
import type { Workout } from "./types.ts";

const fencing: Workout = {
  id: "demo", activityType: "Fencing", startedAt: 1, endedAt: 1419001,
  secondsFromGMT: 28800, durationSeconds: 1419.033,
  distanceMeters: null, activeEnergyKcal: 202.535,
  averageHeartRateBpm: 150.8574, maximumHeartRateBpm: 170,
  elevationAscendedMeters: null, indoor: false,
};

test("fencing and skating show duration and active energy without heart rate", () => {
  assert.deepEqual(workoutMetrics(fencing), [
    { label: "Duration", value: "23:39" },
    { label: "Active energy", value: "202 kcal" },
  ]);
  assert.equal(workoutMetrics({ ...fencing, activityType: "Skating", averageHeartRateBpm: null }).length, 2);
  assert.equal(workoutDuration(6441.922), "1:47:21");
});

test("cycling shows only duration and distance", () => {
  const cycling = { ...fencing, activityType: "Cycling", distanceMeters: 8834.72, durationSeconds: 2274.955 };
  assert.deepEqual(workoutMetrics(cycling), [
    { label: "Duration", value: "37:54" },
    { label: "Distance", value: "8.83 km" },
  ]);
  assert.deepEqual(workoutMetrics({ ...cycling, distanceMeters: null, activeEnergyKcal: null }), [
    { label: "Duration", value: "37:54" },
  ]);
});
