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

test("Fable 没用时，周限额超过 50% 后右端按 (W-50)/50 不可用", () => {
  assert.equal(fableUnavailableShare(weekly(80), 0, 0), 0.6);
  assert.equal(fableUnavailableShare(weekly(51), 0, 0), 0.02);
});

test("Fable 自己的用量已计入周限额，不可用区要扣掉它", () => {
  assert.equal(fableUnavailableShare(weekly(80), 10, 0), 0.5);
  assert.equal(fableUnavailableShare(weekly(80), 30, 0), 0.3);
  assert.equal(fableUnavailableShare(weekly(80), 60, 0), 0);
  assert.equal(fableUnavailableShare(weekly(51), 10, 0), 0);
});

test("周限额不超过 50% 或缺失时没有不可用区，满额时 Fable 剩下的全部不可用", () => {
  assert.equal(fableUnavailableShare(weekly(50), 0, 0), 0);
  assert.equal(fableUnavailableShare(weekly(10), 0, 0), 0);
  assert.equal(fableUnavailableShare(null, 0, 0), 0);
  assert.equal(fableUnavailableShare(weekly(100), 0, 0), 1);
  assert.equal(fableUnavailableShare(weekly(100), 40, 0), 0.6);
});

test("周限额已过期按 0 处理", () => {
  assert.equal(fableUnavailableShare(weekly(80, 1_000), 0, 2_000_000), 0);
  assert.equal(fableUnavailableShare(weekly(80, 3_000), 0, 2_000_000), 0.6);
});
