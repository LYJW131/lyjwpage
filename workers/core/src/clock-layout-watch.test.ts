import assert from "node:assert/strict";
import test from "node:test";

import { heartbeatWindowMs } from "@shared/freshness";
import { CLOCK_LAYOUT_LOOKBACK_MS, clockLayoutTags, type ClockLayoutFeeds } from "./clock-layout-watch";

const NOW = 1_791_960_000_000;
const WINDOW = heartbeatWindowMs();

function feeds(lastSeenAt: number, overrides: Partial<ClockLayoutFeeds> = {}): ClockLayoutFeeds {
  const presence = { lastSeenAt, declaredOffline: false, heartbeatWindowMs: WINDOW };
  return {
    liveness: { lastSeenAt, declaredOffline: false },
    charger: { ...presence, connected: true, totalPower: 30, pushedAt: lastSeenAt, staleAfterMs: WINDOW * 10 },
    powerBank: { ...presence, connected: true, charging: true, outputPower: 0, pushedAt: lastSeenAt, staleAfterMs: WINDOW * 10 },
    ...overrides,
  };
}

test("上报刚断档超窗的那一轮，按时钟藏起的卡全部失效", () => {
  const lastSeenAt = NOW - WINDOW - 30_000;
  assert.deepEqual(clockLayoutTags(feeds(lastSeenAt), NOW), ["desktop", "listening-now", "charger", "powerbank"]);
});

test("还在窗内、早就断档、或已声明离线时不失效", () => {
  assert.deepEqual(clockLayoutTags(feeds(NOW - 10_000), NOW), []);
  assert.deepEqual(clockLayoutTags(feeds(NOW - WINDOW - CLOCK_LAYOUT_LOOKBACK_MS - 1), NOW), []);
  const declared = feeds(NOW - WINDOW - 30_000);
  declared.liveness.declaredOffline = true;
  declared.charger!.declaredOffline = true;
  declared.powerBank!.declaredOffline = true;
  assert.deepEqual(clockLayoutTags(declared, NOW), []);
});

test("卡本来就没亮（没在充、没有数据）只看在线状态", () => {
  const lastSeenAt = NOW - WINDOW - 30_000;
  const idle = feeds(lastSeenAt);
  idle.charger!.totalPower = 0;
  idle.powerBank!.charging = false;
  assert.deepEqual(clockLayoutTags(idle, NOW), ["desktop", "listening-now"]);
  assert.deepEqual(clockLayoutTags(feeds(lastSeenAt, { charger: null, powerBank: null }), NOW), ["desktop", "listening-now"]);
});

test("Mac 在线但充电头推送断流超窗，只失效充电头", () => {
  const live = feeds(NOW - 5_000);
  live.charger!.pushedAt = NOW - live.charger!.staleAfterMs - 30_000;
  assert.deepEqual(clockLayoutTags(live, NOW), ["charger"]);
});
