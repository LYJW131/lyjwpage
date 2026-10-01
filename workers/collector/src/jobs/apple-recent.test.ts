import assert from "node:assert/strict";
import test from "node:test";

import { ACTIVE_HOLD_MS, appleRecentDue, IDLE_EVERY_MINUTES } from "./apple-recent";

const MINUTE = 60_000;
const BOUNDARY = 29_000_000 * MINUTE;

test("闲档只在整 5 分钟拉，列表刚变过就每分钟拉，超出保持期回闲档", () => {
  assert.equal(IDLE_EVERY_MINUTES, 5);
  assert.equal(appleRecentDue(BOUNDARY, undefined), true);
  assert.equal(appleRecentDue(BOUNDARY + MINUTE, undefined), false);
  assert.equal(appleRecentDue(BOUNDARY + MINUTE, BOUNDARY), true);
  assert.equal(appleRecentDue(BOUNDARY + 3 * MINUTE, BOUNDARY + MINUTE), true);
  assert.equal(appleRecentDue(BOUNDARY + 11 * MINUTE, BOUNDARY), false);
  assert.equal(appleRecentDue(BOUNDARY + ACTIVE_HOLD_MS - MINUTE, BOUNDARY), true);
});
