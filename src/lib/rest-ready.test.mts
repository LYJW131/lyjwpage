import assert from "node:assert/strict";
import test from "node:test";

import {
  isRestReady,
  markRestReady,
  resetRestReadyForTests,
  subscribeRestReady,
} from "./rest-ready.ts";

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
