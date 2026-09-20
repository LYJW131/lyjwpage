import assert from "node:assert/strict";
import test from "node:test";
import { activityPulseSample } from "@shared/pulse-activity";
import type { StoredActivity } from "@shared/activity";
import { compressPulseWindow } from "@/lib/pulse-window";
import { pulseLaneRuns } from "@/lib/pulse-lane";
import { parsePulseSample, planPulseSample } from "@/lib/pulse";

const T = Date.parse("2026-09-20T08:00:00Z");
const HOUR = 3_600_000;
function snapshot(at: number, fields: Partial<StoredActivity["activity"]> = {}): StoredActivity {
  return { receivedAt: at, activity: {
    date: "2026-09-20", secondsFromGMT: 0,
    moveKcal: 100, moveGoalKcal: 400, exerciseMinutes: 0, exerciseGoalMinutes: 30,
    standHours: 2, standGoalHours: 12, steps: 1000, distanceMeters: 600, flightsClimbed: 0,
    ...fields,
  } };
}

test("activity estimates the completed interval, not the accumulated daily total", () => {
  const previous = snapshot(T);
  assert.equal(activityPulseSample(null, previous), null);
  for (const [steps, level] of [[1000, 0], [1100, 1], [2200, 2], [4600, 3]]) {
    assert.deepEqual(activityPulseSample(previous, snapshot(T + HOUR, { steps })), {
      t: T, until: T + HOUR, level,
    });
  }
  assert.equal(activityPulseSample(previous, snapshot(T + HOUR, { exerciseMinutes: 30, steps: null }))?.level, 3);
  assert.equal(activityPulseSample(previous, snapshot(T + HOUR, { exerciseMinutes: 6 }))?.level, 2);
  assert.equal(activityPulseSample(previous, snapshot(T + HOUR, { moveKcal: 101 }))?.level, 1);
  assert.equal(activityPulseSample(previous, snapshot(T + HOUR, { standHours: 3 }))?.level, 1);
});

test("activity leaves unknown intervals empty across resets, gaps and corrections", () => {
  const previous = snapshot(T);
  for (const next of [
    snapshot(T), snapshot(T - HOUR), snapshot(T + 30_000), snapshot(T + 2 * HOUR + 1),
    snapshot(T + HOUR, { date: "2026-09-21" }),
    snapshot(T + HOUR, { secondsFromGMT: 3600 }),
    snapshot(T + HOUR, { steps: 999 }), snapshot(T + HOUR, { moveKcal: 99 }),
  ]) assert.equal(activityPulseSample(previous, next), null);
  assert.equal(activityPulseSample(snapshot(T, { date: "2026-09-19" }), snapshot(T + HOUR, { date: "2026-09-19" })), null);
});

test("bounded intervals survive storage and end identically in the graph and score window", () => {
  for (const level of [0, 3] as const) {
    const sample = { t: T, until: T + HOUR, level };
    assert.deepEqual(parsePulseSample(JSON.stringify(sample)), sample);
    assert.deepEqual(planPulseSample({ t: T - HOUR, until: T, level }, sample), sample);
    const window = { from: T + 30 * 60_000, to: T + 2 * HOUR };
    const clipped = compressPulseWindow([sample], window).segments.map((part) => ({ t: part.from, until: part.to, level: part.level }));
    assert.deepEqual(clipped, [{ ...sample, t: window.from }]);
    const expected = [{ from: window.from, to: sample.until, level }];
    assert.deepEqual(compressPulseWindow([sample], window).segments, expected);
    assert.deepEqual(pulseLaneRuns(clipped, window, 600_000), expected);
    assert.deepEqual(compressPulseWindow([sample], { from: sample.until, to: sample.until + HOUR }).segments, []);
  }
  assert.equal(parsePulseSample(JSON.stringify({ t: T, until: T, level: 1 })), null);
});
