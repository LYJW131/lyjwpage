import assert from "node:assert/strict";
import test from "node:test";

import { RECOVERY_DELAYS_MS, RECOVERY_FORGET_MS, createFaultLedger, describeFault } from "./card-recovery.ts";

test("反复崩：自动重试的间隔逐步放长，用完之后不再自动试", () => {
  const ledger = createFaultLedger();
  const seen = [0, 1, 2, 3, 4].map((step) => ledger.record("Pulse", "boom", step * 1_000).retryInMs);
  assert.deepEqual(seen, [...RECOVERY_DELAYS_MS, null, null]);
  assert.equal(ledger.record("Pulse", "boom", 6_000).attempt, RECOVERY_DELAYS_MS.length, "attempt 是崩溃之前已经自动试过几次");
});

test("同一张卡同样的错在一轮里只报一次，换了错误或换了卡照报", () => {
  const ledger = createFaultLedger();
  assert.equal(ledger.record("Pulse", "boom", 0).report, true);
  assert.equal(ledger.record("Pulse", "boom", 20_000).report, false);
  assert.equal(ledger.record("Pulse", "another failure", 40_000).report, true);
  assert.equal(ledger.record("Activity", "boom", 40_000).report, true);
});

test("各张卡各算各的，一张卡用完重试不影响别的卡", () => {
  const ledger = createFaultLedger();
  for (let step = 0; step < 6; step += 1) ledger.record("Pulse", "boom", step);
  assert.equal(ledger.record("Pulse", "boom", 10).retryInMs, null);
  assert.equal(ledger.record("Activity", "boom", 10).retryInMs, RECOVERY_DELAYS_MS[0]);
});

test("隔了足够久没再崩，上一轮就算结束：重试次数和上报去重都从头算", () => {
  const ledger = createFaultLedger();
  for (let step = 0; step < 5; step += 1) ledger.record("Pulse", "boom", step * 1_000);
  const later = ledger.record("Pulse", "boom", 4_000 + RECOVERY_FORGET_MS + 1);
  assert.equal(later.retryInMs, RECOVERY_DELAYS_MS[0]);
  assert.equal(later.report, true);
  assert.equal(later.attempt, 0);
});

test("一轮里只要还在崩，就一直算同一轮（遗忘的钟是从最近一次崩溃起算）", () => {
  const ledger = createFaultLedger();
  ledger.record("Pulse", "boom", 0);
  ledger.record("Pulse", "boom", RECOVERY_FORGET_MS - 1);
  const third = ledger.record("Pulse", "boom", RECOVERY_FORGET_MS * 2 - 2);
  assert.equal(third.report, false);
  assert.equal(third.attempt, 2);
});

test("describeFault：Error 取 message，字符串照用，别的转成字符串，并截断", () => {
  assert.equal(describeFault(new TypeError("x is not a function")), "x is not a function");
  assert.equal(describeFault("plain"), "plain");
  assert.equal(describeFault({ code: 1 }), "[object Object]");
  assert.equal(describeFault(undefined), "undefined");
  assert.equal(describeFault(new Error("a".repeat(500))).length, 200);
});
