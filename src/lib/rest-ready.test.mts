import assert from "node:assert/strict";
import test from "node:test";

import {
  isRestReady,
  markRestReady,
  resetRestReadyForTests,
  resolveImageLoading,
  subscribeRestReady,
} from "./rest-ready.ts";

test("首屏没揭开时图保持原样，揭开后一律 eager", () => {
  assert.deepEqual(resolveImageLoading(false, undefined, undefined), {});
  assert.deepEqual(resolveImageLoading(false, "lazy", undefined), { loading: "lazy" });
  assert.deepEqual(resolveImageLoading(false, "eager", undefined), { loading: "eager" });
  assert.deepEqual(resolveImageLoading(true, undefined, undefined), { loading: "eager" });
  assert.deepEqual(resolveImageLoading(true, "lazy", undefined), { loading: "eager" });
  assert.deepEqual(resolveImageLoading(true, "eager", false), { loading: "eager" });
});

test("priority 不带 loading，避免和 next/image 的预载冲突", () => {
  assert.deepEqual(resolveImageLoading(false, "lazy", true), {});
  assert.deepEqual(resolveImageLoading(true, "lazy", true), {});
  assert.deepEqual(resolveImageLoading(true, undefined, true), {});
});

test("揭开只通知一次", () => {
  resetRestReadyForTests();
  assert.equal(isRestReady(), false);
  let calls = 0;
  const stop = subscribeRestReady(() => {
    calls += 1;
  });
  markRestReady();
  markRestReady();
  assert.equal(isRestReady(), true);
  assert.equal(calls, 1);
  stop();
  markRestReady();
  assert.equal(calls, 1);
  resetRestReadyForTests();
});
