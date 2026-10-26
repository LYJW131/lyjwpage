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
