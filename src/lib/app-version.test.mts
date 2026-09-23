import assert from "node:assert/strict";
import test from "node:test";

import { resolveVersionStatus } from "./app-version.ts";

test("两边 sha 一致就是最新", () => {
  assert.equal(resolveVersionStatus("a".repeat(40), "a".repeat(40)), "current");
});

test("对不上就是旧页面", () => {
  assert.equal(resolveVersionStatus("a".repeat(40), "b".repeat(40)), "stale");
});

test("任一边拿不到都是 unknown，不误报成旧", () => {
  assert.equal(resolveVersionStatus(null, "b".repeat(40)), "unknown");
  assert.equal(resolveVersionStatus("a".repeat(40), null), "unknown");
  assert.equal(resolveVersionStatus(null, null), "unknown");
  assert.equal(resolveVersionStatus("", "b".repeat(40)), "unknown");
  assert.equal(resolveVersionStatus("a".repeat(40), ""), "unknown");
});
