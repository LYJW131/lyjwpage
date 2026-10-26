import assert from "node:assert/strict";
import { test } from "node:test";
import { clamp, percent } from "./verify-retry-demo.ts";

test("clamp 把值夹在上下限之间", () => {
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-1, 0, 3), 0);
  assert.equal(clamp(2, 0, 3), 2);
});

test("percent 总数为 0 时返回 0", () => {
  assert.equal(percent(1, 0), 0);
});

test("percent 保留一位小数，四舍五入", () => {
  assert.equal(percent(1, 3), 33.3);
  assert.equal(percent(2, 3), 66.7);
  assert.equal(percent(29, 100), 29);
});
