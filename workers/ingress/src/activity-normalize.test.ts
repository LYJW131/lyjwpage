import assert from "node:assert/strict";
import test from "node:test";

import { normalizeActivity } from "@shared/ingest/activity";

const FROM = Date.UTC(2026, 8, 28, 0, 0);
const STEP = 5 * 60_000;

function report(buckets: Array<{ steps: number | null; moveKcal: number | null; exerciseMinutes: number | null }>) {
  return {
    history: {
      from: FROM,
      to: FROM + buckets.length * STEP,
      buckets: buckets.map((b, i) => ({ from: FROM + i * STEP, to: FROM + (i + 1) * STEP, ...b })),
    },
  };
}

const receivedAt = FROM + 60 * STEP;

test("normalizeActivity：历史桶按固定精度量化，null 保持 null", () => {
  const { history } = normalizeActivity(report([
    { steps: 41.6, moveKcal: 0.8645179848079124, exerciseMinutes: 1.23456 },
    { steps: null, moveKcal: 0.04, exerciseMinutes: null },
  ]), receivedAt);
  assert.deepEqual(history?.buckets.map(({ steps, moveKcal, exerciseMinutes }) => ({ steps, moveKcal, exerciseMinutes })), [
    { steps: 42, moveKcal: 0.9, exerciseMinutes: 1.23 },
    { steps: null, moveKcal: 0, exerciseMinutes: null },
  ]);
});

test("normalizeActivity：只差浮点噪声的两次上报收敛成相同的桶", () => {
  const a = normalizeActivity(report([{ steps: 120, moveKcal: 3.2100000000000004, exerciseMinutes: 0.5000000001 }]), receivedAt);
  const b = normalizeActivity(report([{ steps: 120.00000001, moveKcal: 3.2099999999999995, exerciseMinutes: 0.4999999999 }]), receivedAt);
  assert.deepEqual(a.history, b.history);
});
