import assert from "node:assert/strict";
import test from "node:test";

import { compactCount, duration } from "./digest/facts.ts";

test("时长不足一小时按五分钟粒度取粗，不足五分钟也按五分钟报", () => {
  assert.equal(duration(0), "5 min");
  assert.equal(duration(299), "5 min");
  assert.equal(duration(449), "5 min");
  assert.equal(duration(450), "10 min");
  assert.equal(duration(3599), "60 min");
});

test("时长满一小时起按半小时粒度取粗", () => {
  assert.equal(duration(3600), "1 h");
  assert.equal(duration(5400), "1.5 h");
  assert.equal(duration(8100), "2.5 h");
  assert.equal(duration(84600), "23.5 h");
});

test("计数按数量级缩写，只留两位有效数字，压线值进位到下一档门口", () => {
  assert.equal(compactCount(0), "0");
  assert.equal(compactCount(949), "950");
  assert.equal(compactCount(999), "1000");
  assert.equal(compactCount(1_000), "1K");
  assert.equal(compactCount(1_500), "1.5K");
  assert.equal(compactCount(12_345), "12K");
  assert.equal(compactCount(999_999), "1000K");
  assert.equal(compactCount(1_200_000), "1.2M");
  assert.equal(compactCount(2_500_000_000), "2.5B");
});
