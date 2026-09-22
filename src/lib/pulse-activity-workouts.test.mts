import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTIVITY_CONTINUITY,
  ACTIVITY_INTENSITY,
  activityQuestions,
  activityWindowFeatures,
  parseActivityWorkouts,
  type ActivityWorkout,
} from "@shared/pulse-activity";

const WINDOW_MS = 300_000;
/** 生产 /api/status/workouts 在 2026-09-22 读到的最近一次击剑。 */
const FENCING_SEP22: ActivityWorkout = {
  activityType: "Fencing",
  startedAt: 1_790_013_589_069,
  endedAt: 1_790_015_128_063,
  durationSeconds: 1538.993,
};
const FENCING_SEP20: ActivityWorkout = {
  activityType: "Fencing",
  startedAt: 1_789_840_243_505,
  endedAt: 1_789_841_662_538,
  durationSeconds: 1419.033,
};

function windowsBetween(start: number, end: number) {
  const windows: { from: number; to: number }[] = [];
  for (let from = Math.floor(start / WINDOW_MS) * WINDOW_MS; from < end; from += WINDOW_MS) {
    windows.push({ from, to: from + WINDOW_MS });
  }
  return windows;
}

test("a reported fencing session enters overlapping five-minute windows by its sport name", () => {
  const slices = windowsBetween(FENCING_SEP22.startedAt, FENCING_SEP22.endedAt).map((window) =>
    activityWindowFeatures([], window, [FENCING_SEP20, FENCING_SEP22]));
  assert.ok(slices.length >= 5);
  assert.ok(slices.every((slice) => slice.features.workouts.length === 1 && slice.features.workouts[0]?.activityType === "Fencing"));
  assert.ok(slices.every((slice) => slice.features.workoutSeconds > 0 && slice.coverage.length === 1));
  const full = slices.filter((slice) => slice.features.workoutPercent >= 75);
  assert.ok(full.length >= 4, "most of the session fills a five-minute window");
  assert.ok(full.every((slice) => slice.features.vigorousSeconds === 0));
  const total = slices.reduce((sum, slice) => sum + slice.features.workoutSeconds, 0);
  assert.ok(Math.abs(total - Math.round(FENCING_SEP22.durationSeconds)) <= slices.length);
  assert.equal(JSON.stringify(slices[0]?.features).includes(String(FENCING_SEP22.startedAt)), false);
});

test("early morning with no reported workout stays out of the criteria", () => {
  const dawn = Date.parse("2026-09-21T02:00:00+08:00");
  const window = { from: Math.floor(dawn / WINDOW_MS) * WINDOW_MS, to: Math.floor(dawn / WINDOW_MS) * WINDOW_MS + WINDOW_MS };
  const features = activityWindowFeatures([], window, [FENCING_SEP20, FENCING_SEP22]).features;
  assert.deepEqual(features.workouts, []);
  assert.equal(features.workoutSeconds, 0);
  assert.equal(features.observedSeconds, 0);
});

test("a window filled by a named workout matches the top intensity and continuity bands", () => {
  const window = { from: 1_800_000_000_000, to: 1_800_000_000_000 + WINDOW_MS };
  const features = activityWindowFeatures([], window, [{
    activityType: "Fencing",
    startedAt: window.from,
    endedAt: window.to,
    durationSeconds: 300,
  }]).features;
  assert.equal(features.workoutPercent, 100);
  assert.equal(features.movingPercent, 0);
  assert.match(ACTIVITY_INTENSITY[4], /`workoutPercent` 50 or above/);
  assert.match(ACTIVITY_CONTINUITY[3], /`workoutPercent` 75 or above/);
  assert.match(ACTIVITY_INTENSITY[0], /`workoutPercent` is 0/);
  assert.match(activityQuestions().intensity.instructions, /Fencing/);
});

test("ring-only windows keep their buckets and record no workout", () => {
  const window = { from: 0, to: WINDOW_MS };
  const features = activityWindowFeatures([{ t: 0, until: WINDOW_MS, level: 3 }], window).features;
  assert.equal(features.vigorousSeconds, 300);
  assert.equal(features.vigorousPercent, 100);
  assert.equal(features.workoutPercent, 0);
  assert.deepEqual(features.workouts, []);
});

test("parseActivityWorkouts keeps the sport name and drops a malformed row", () => {
  const raw = JSON.stringify({ items: [FENCING_SEP22, { activityType: "", startedAt: 1, endedAt: 2, durationSeconds: 1 }] });
  assert.deepEqual(parseActivityWorkouts(raw), [FENCING_SEP22]);
  assert.deepEqual(parseActivityWorkouts("{"), []);
});
