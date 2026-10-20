import assert from "node:assert/strict";
import test from "node:test";

import {
  chargingSegments,
  chargingSessions,
  chargingSummary,
  currentChargingPower,
  planChargingSample,
  replaceActivityBuckets,
} from "@shared/pulse-timeline";

const T = 1_800_000_000_000;
const M = 60_000;

test("charging gate: idle crossings are immediate, powered changes wait 30 s and must be significant, re-confirm after 5 min", () => {
  const first = planChargingSample(null, { t: T, watts: 45.04, device: "MacBook Pro" })!;
  assert.deepEqual(first, { t: T, watts: 45, device: "MacBook Pro" });
  assert.equal(planChargingSample(first, { t: T + 10_000, watts: 60, device: "MacBook Pro" }), null);
  assert.equal(planChargingSample(first, { t: T + 40_000, watts: 46, device: "MacBook Pro" }), null, "under 2 W");
  assert.ok(planChargingSample(first, { t: T + 40_000, watts: 60, device: "MacBook Pro" }));
  assert.ok(planChargingSample(first, { t: T + 1_000, watts: 0, device: "MacBook Pro" }), "unplugging is immediate");
  const idle = { t: T, watts: 0.3 };
  assert.equal(planChargingSample(idle, { t: T + 40_000, watts: 0.8 }), null, "flutter below the idle line");
  assert.ok(planChargingSample(idle, { t: T + 5 * M, watts: 0.3 }));
});

test("charging segments leave outages unknown; summary and sessions integrate held samples", () => {
  const samples = [{ t: T, watts: 0 }, { t: T + M, watts: 60 }, { t: T + 6 * M, watts: 60 }, { t: T + 30 * M, watts: 20 }];
  const segments = chargingSegments(samples, { from: T, to: T + 60 * M });
  assert.deepEqual(segments.map((row) => [row.from - T, row.to - T, row.watts]), [[0, M, 0], [M, 16 * M, 60], [30 * M, 40 * M, 20]]);
  assert.deepEqual(chargingSummary(segments), { peakW: 60, energyWh: Math.round((60 * 0.25 + 20 / 6) * 10) / 10 });
  assert.equal(currentChargingPower(samples, T + 35 * M), 20);
  assert.equal(currentChargingPower(samples, T + 45 * M), null, "stale is unknown, not zero");
  assert.deepEqual(chargingSessions(samples, T + 60 * M).map((row) => [row.startedAt - T, row.endedAt - T, row.peakW, row.energyWh]), [
    [M, 16 * M, 60, 15],
    [30 * M, 40 * M, 20, 3.333],
  ]);
});

test("activity replacement reports the first changed index and ignores key order", () => {
  const bucket = (i: number, steps: number | null) => ({ from: T + i * 5 * M, to: T + (i + 1) * 5 * M, steps, moveKcal: null, exerciseMinutes: null });
  const previous = [bucket(0, 10), bucket(1, 20), bucket(2, 30)];
  const reordered = { exerciseMinutes: null, moveKcal: null, steps: 20, to: T + 10 * M, from: T + 5 * M };
  const same = replaceActivityBuckets(previous, { from: T + 5 * M, to: T + 15 * M }, [reordered, bucket(2, 30)]);
  assert.equal(same.changed, false);
  const changed = replaceActivityBuckets(previous, { from: T + 5 * M, to: T + 15 * M }, [reordered, bucket(2, 35)]);
  assert.equal(changed.firstChanged, 2);
  assert.deepEqual(changed.next.map((row) => row.steps), [10, 20, 35]);
  const removed = replaceActivityBuckets(previous, { from: T + 5 * M, to: T + 15 * M }, []);
  assert.deepEqual(removed.next.map((row) => row.steps), [10], "omitted buckets inside the range become unknown");
});
