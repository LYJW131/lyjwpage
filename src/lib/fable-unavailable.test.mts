import assert from "node:assert/strict";
import test from "node:test";

import { fableUnavailableShare } from "@/components/live/vibecoding/limits.ts";
import type { VibeCodingLimit } from "@shared/types";

const weekly = (usedPercent: number, resetsAt: number | null = null): VibeCodingLimit => ({
  key: "weekly_all",
  label: null,
  group: "weekly",
  windowMinutes: 10080,
  usedPercent,
  resetsAt,
});

test("周限额超过 50% 后 Fable 条右端按 (W-50)/50 不可用", () => {
  assert.equal(fableUnavailableShare(weekly(80), 0), 0.6);
  assert.equal(fableUnavailableShare(weekly(51), 0), 0.02);
});

test("周限额不超过 50% 或缺失时没有不可用区，满额封顶整条", () => {
  assert.equal(fableUnavailableShare(weekly(50), 0), 0);
  assert.equal(fableUnavailableShare(weekly(10), 0), 0);
  assert.equal(fableUnavailableShare(null, 0), 0);
  assert.equal(fableUnavailableShare(weekly(100), 0), 1);
});

test("周限额已过期按 0 处理", () => {
  assert.equal(fableUnavailableShare(weekly(80, 1_000), 2_000_000), 0);
  assert.equal(fableUnavailableShare(weekly(80, 3_000), 2_000_000), 0.6);
});
