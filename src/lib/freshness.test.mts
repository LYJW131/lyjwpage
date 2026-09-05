import assert from "node:assert/strict";
import test from "node:test";
import { agentLimitsStaleMs, isStale } from "./freshness.ts";

test("限额陈旧窗口覆盖三轮闲档，并在缓存余量耗尽后变陈旧", () => {
  const previous = process.env.AGENT_LIMITS_STALE_MS;
  try {
    delete process.env.AGENT_LIMITS_STALE_MS;
    const windowMs = agentLimitsStaleMs();
    assert.equal(windowMs, 185 * 60_000);
    const at = 1_000;
    assert.equal(isStale({ now: at + 3 * 60 * 60_000, at, windowMs }), false);
    assert.equal(isStale({ now: at + windowMs, at, windowMs }), false);
    assert.equal(isStale({ now: at + windowMs + 1, at, windowMs }), true);
    process.env.AGENT_LIMITS_STALE_MS = "14400000";
    assert.equal(agentLimitsStaleMs(), 14_400_000);
    for (const invalid of ["", "no", "0", "-1", "Infinity"]) {
      process.env.AGENT_LIMITS_STALE_MS = invalid;
      assert.equal(agentLimitsStaleMs(), windowMs);
    }
  } finally {
    if (previous === undefined) delete process.env.AGENT_LIMITS_STALE_MS;
    else process.env.AGENT_LIMITS_STALE_MS = previous;
  }
});
