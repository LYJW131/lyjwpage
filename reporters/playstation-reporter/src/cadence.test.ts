import assert from "node:assert/strict";
import test from "node:test";

import {
  AWAKE_TICK_INTERVAL_MS,
  IDLE_TICK_INTERVAL_MS,
  OFF_STREAK_TO_REST,
  settleProbe,
  shouldRunTick,
} from "../dist/cadence.js";

test("an awake console ticks on the fast interval and a resting one waits for idle", () => {
  assert.equal(shouldRunTick({ sinceMs: AWAKE_TICK_INTERVAL_MS, power: "awake", powerAtLastTick: "awake" }), true);
  assert.equal(shouldRunTick({ sinceMs: AWAKE_TICK_INTERVAL_MS - 1, power: "awake", powerAtLastTick: "awake" }), false);
  assert.equal(shouldRunTick({ sinceMs: IDLE_TICK_INTERVAL_MS - 1, power: "standby", powerAtLastTick: "resting" }), false);
  assert.equal(shouldRunTick({ sinceMs: IDLE_TICK_INTERVAL_MS - 1, power: "off", powerAtLastTick: "resting" }), false);
  assert.equal(shouldRunTick({ sinceMs: IDLE_TICK_INTERVAL_MS, power: "off", powerAtLastTick: "resting" }), true);
});

test("waking or sleeping runs a tick immediately, and the first tick always runs", () => {
  assert.equal(shouldRunTick({ sinceMs: 1_000, power: "awake", powerAtLastTick: "resting" }), true);
  assert.equal(shouldRunTick({ sinceMs: 1_000, power: "standby", powerAtLastTick: "awake" }), true);
  assert.equal(shouldRunTick({ sinceMs: 1_000, power: "off", powerAtLastTick: "awake" }), true);
  assert.equal(shouldRunTick({ sinceMs: Number.POSITIVE_INFINITY, power: "off", powerAtLastTick: null }), true);
  // 休息和关机是同一档，来回切不额外打 PSN
  assert.equal(shouldRunTick({ sinceMs: 1_000, power: "off", powerAtLastTick: "resting" }), false);
});

test("one lost discovery packet does not drop an awake console into the idle tier", () => {
  let power = "awake" as const;
  let offStreak = 0;
  for (let i = 0; i < OFF_STREAK_TO_REST - 1; i += 1) {
    ({ power, offStreak } = settleProbe(power, "off", offStreak));
    assert.equal(power, "awake");
  }
  ({ power, offStreak } = settleProbe(power, "off", offStreak));
  assert.equal(power, "off");
  ({ power, offStreak } = settleProbe(power, "awake", offStreak));
  assert.deepEqual({ power, offStreak }, { power: "awake", offStreak: 0 });
  ({ power, offStreak } = settleProbe(power, "standby", offStreak));
  assert.deepEqual({ power, offStreak }, { power: "standby", offStreak: 0 });
});
