import assert from "node:assert/strict";
import test from "node:test";

import { formatClock } from "./clock-format.ts";

test("formatClock 按整秒向下取，满一小时写成 h:mm:ss", () => {
  assert.equal(formatClock(0), "0:00");
  assert.equal(formatClock(-1_000), "0:00");
  assert.equal(formatClock(Number.NaN), "0:00");
  assert.equal(formatClock(999), "0:00");
  assert.equal(formatClock(1_499), "0:01");
  assert.equal(formatClock(1_500), "0:01");
  assert.equal(formatClock(83_000), "1:23");
  assert.equal(formatClock(3_600_000), "1:00:00");
  assert.equal(formatClock(3_723_000), "1:02:03");
});
