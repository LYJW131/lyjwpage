import assert from "node:assert/strict";
import test from "node:test";

import { pulseWorkoutMarks, type PulseWorkoutSource } from "@/lib/pulse-workouts";

const DAY = 86_400_000;
/** 2026-09-22 08:07 Asia/Shanghai。窗口是此前 24 小时。 */
const NOW = Date.parse("2026-09-22T08:07:00+08:00");
const WINDOW = { from: NOW - DAY, to: NOW };

/** 生产 /api/status/workouts 在 2026-09-22 读到的两次最近击剑，时间原样保留。 */
const FENCING_SEP22: PulseWorkoutSource = {
  id: "e3389897-4be9-45af-9e5d-be7480a89b50",
  activityType: "Fencing",
  startedAt: 1_790_013_589_069,
  endedAt: 1_790_015_128_063,
  durationSeconds: 1538.993,
};
const FENCING_SEP20: PulseWorkoutSource = {
  id: "bce62c59-1f2a-4bea-aab6-ddd015920583",
  activityType: "Fencing",
  startedAt: 1_789_840_243_505,
  endedAt: 1_789_841_662_538,
  durationSeconds: 1419.033,
};

test("pulse activity bar keeps the reported sport name at the workout's time", () => {
  const marks = pulseWorkoutMarks([FENCING_SEP20, FENCING_SEP22], WINDOW);
  assert.equal(marks.length, 1);
  assert.equal(marks[0]?.activityType, "Fencing");
  assert.equal(marks[0]?.id, FENCING_SEP22.id);
  assert.equal(marks[0]?.startedAt, FENCING_SEP22.startedAt);
  assert.equal(marks[0]?.durationSeconds, FENCING_SEP22.durationSeconds);
  const start = (FENCING_SEP22.startedAt - WINDOW.from) / DAY;
  assert.ok(Math.abs((marks[0]?.start ?? 0) - start) < 1e-9);
  assert.ok((marks[0]?.span ?? 0) > 0 && (marks[0]?.span ?? 1) < 0.03);
});

test("early morning with no reported workout stays empty", () => {
  const dawnFrom = Date.parse("2026-09-21T00:00:00+08:00");
  const dawnTo = Date.parse("2026-09-21T06:00:00+08:00");
  const marks = pulseWorkoutMarks([FENCING_SEP20, FENCING_SEP22], WINDOW);
  assert.equal(marks.some((mark) => mark.endedAt > dawnFrom && mark.startedAt < dawnTo), false);
  assert.equal(pulseWorkoutMarks([FENCING_SEP20], WINDOW).length, 0);
});

test("a workout that crosses the window edge is clipped to the visible part and keeps its name", () => {
  const ride: PulseWorkoutSource = {
    id: "33333333-3333-4333-8333-333333333333",
    activityType: "Cycling",
    startedAt: WINDOW.from - 30 * 60_000,
    endedAt: WINDOW.from + 20 * 60_000,
    durationSeconds: 50 * 60,
  };
  const [mark] = pulseWorkoutMarks([ride], WINDOW);
  assert.equal(mark?.activityType, "Cycling");
  assert.equal(mark?.start, 0);
  assert.equal(mark?.startedAt, ride.startedAt);
  assert.ok(Math.abs((mark?.span ?? 0) - (20 * 60_000) / DAY) < 1e-9);
});

test("names that would overlap stack onto another row; distant ones stay on the first row", () => {
  const at = (hour: number, name: string, index: number): PulseWorkoutSource => ({
    id: `44444444-4444-4444-8444-${String(index).padStart(12, "0")}`,
    activityType: name,
    startedAt: WINDOW.from + hour * 3_600_000,
    endedAt: WINDOW.from + hour * 3_600_000 + 20 * 60_000,
    durationSeconds: 20 * 60,
  });
  const marks = pulseWorkoutMarks([at(2, "Fencing", 1), at(3, "Cycling", 2), at(16, "Skating", 3)], WINDOW);
  assert.deepEqual(marks.map((mark) => mark.activityType), ["Fencing", "Cycling", "Skating"]);
  assert.equal(marks[0]?.row, 0);
  assert.equal(marks[1]?.row, 1);
  assert.equal(marks[2]?.row, 0);
});

test("a workout against the right edge keeps its name inside the lane", () => {
  const late: PulseWorkoutSource = {
    id: "55555555-5555-4555-8555-555555555555",
    activityType: "Fencing",
    startedAt: WINDOW.to - 10 * 60_000,
    endedAt: WINDOW.to - 60_000,
    durationSeconds: 9 * 60,
  };
  const [mark] = pulseWorkoutMarks([late], WINDOW);
  assert.equal(mark?.alignEnd, true);
  assert.ok((mark?.labelStart ?? 0) >= 0);
  assert.ok((mark?.labelStart ?? 0) + 0.3 <= (mark?.start ?? 0) + (mark?.span ?? 0) + 1e-9);
});
