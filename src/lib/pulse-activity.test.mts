import assert from "node:assert/strict";
import test from "node:test";
import { activityHistoryPulseSample } from "@shared/pulse-activity";
import { compressPulseWindow } from "@/lib/pulse-window";
import { pulseLaneRuns } from "@/lib/pulse-lane";
import { parsePulseSample, planPulseSample } from "@/lib/pulse";

const T = Date.parse("2026-09-20T08:00:00Z");
const HOUR = 3_600_000;
test("activity maps each closed HealthKit bucket without depending on upload cadence", () => {
  const sample = (values: { moveKcal: number | null; exerciseMinutes: number | null; steps: number | null }) =>
    activityHistoryPulseSample({ from: T, to: T + 5 * 60_000, ...values });
  assert.equal(sample({ moveKcal: 0, exerciseMinutes: null, steps: 0 }), null);
  assert.equal(sample({ moveKcal: 0, exerciseMinutes: 0, steps: 0 })?.level, 0);
  assert.equal(sample({ moveKcal: 1, exerciseMinutes: null, steps: null })?.level, 1);
  assert.equal(sample({ moveKcal: null, exerciseMinutes: 0.5, steps: 99 })?.level, 2);
  assert.equal(sample({ moveKcal: null, exerciseMinutes: 2.5, steps: 300 })?.level, 3);
  assert.deepEqual(sample({ moveKcal: 1, exerciseMinutes: null, steps: null }), {
    t: T, until: T + 5 * 60_000, level: 1,
  });
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
