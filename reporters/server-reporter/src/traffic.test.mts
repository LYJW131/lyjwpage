/**
 * 流量累计、推送账本这几个纯函数的单测（从 Python 版 reporter_test.py 搬过来）。
 * 采集和推送要么读 /proc、要么打网络，没有值得钉住的判断；这几个函数错了是「流量默默
 * 多算一倍」这种没人看得出来的错，正是要钉住的那类。
 */
import assert from "node:assert/strict";
import test from "node:test";

import { accumulate, cycleBounds, shiftMonth } from "../dist/traffic.js";
import { BUCKET_MS, countPushes, recordPush, WINDOW_MS as LEDGER_WINDOW_MS } from "../dist/push-ledger.js";
import { cpuPercent } from "../dist/system.js";
import { parseAs } from "../dist/geo.js";

const ms = (text: string) => Date.parse(`${text}Z`);

test("周期边界：自然月、账单日之前算上个周期、零点整、跨年", () => {
  assert.deepEqual(cycleBounds(ms("2026-09-15T12:00:00"), 1), [ms("2026-09-01T00:00:00"), ms("2026-10-01T00:00:00")]);
  assert.deepEqual(cycleBounds(ms("2026-09-03T00:00:00"), 20), [ms("2026-08-20T00:00:00"), ms("2026-09-20T00:00:00")]);
  assert.equal(cycleBounds(ms("2026-09-20T00:00:00"), 20)[0], ms("2026-09-20T00:00:00"));
  assert.deepEqual(cycleBounds(ms("2026-12-31T23:59:59"), 5), [ms("2026-12-05T00:00:00"), ms("2027-01-05T00:00:00")]);
  const moment = new Date(ms("2026-01-28T00:00:00"));
  assert.equal(shiftMonth(moment, 1).getUTCMonth(), 1);
  assert.equal(shiftMonth(moment, 1).getUTCDate(), 28);
  assert.equal(shiftMonth(moment, -1).getUTCFullYear(), 2025);
});

test("第一轮只记游标：开机很久的机器，计数器里的旧字节不算进这个周期", () => {
  const state = accumulate({}, "enp3s0", 5_000_000_000_000, 900_000_000_000, ms("2026-09-10T00:00:00"), 1);
  assert.equal(state.rxBytes, 0);
  assert.equal(state.txBytes, 0);
  assert.equal(state.rxCursor, 5_000_000_000_000);
});

test("开机在周期之内：计数器整份接管；开机在周期之前：从零", () => {
  const now = ms("2026-09-15T00:00:00");
  const inside = accumulate({}, "enp3s0", 700_000, 400_000, now, 1, ms("2026-09-08T00:00:00"));
  assert.deepEqual([inside.rxBytes, inside.txBytes], [700_000, 400_000]);
  const before = accumulate({}, "enp3s0", 5_000_000, 4_000_000, now, 1, ms("2026-08-20T00:00:00"));
  assert.deepEqual([before.rxBytes, before.txBytes], [0, 0]);
});

test("换网卡不按开机时刻接管：旧卡那段已经数过了", () => {
  const now = ms("2026-09-15T00:00:00");
  let old = accumulate({}, "enp3s0", 1_000, 1_000, now, 1);
  old = accumulate(old, "enp3s0", 3_000, 3_000, now + 60_000, 1);
  const moved = accumulate(old, "eth0", 90_000, 80_000, now + 120_000, 1, ms("2026-09-08T00:00:00"));
  assert.equal(moved.rxBytes, 0);
});

test("逐轮加增量；计数器归零时这次读数本身就是增量", () => {
  const now = ms("2026-09-10T00:00:00");
  const first = accumulate({}, "enp3s0", 1_000, 500, now, 1);
  const second = accumulate(first, "enp3s0", 1_800, 900, now + 60_000, 1);
  assert.deepEqual([second.rxBytes, second.txBytes], [800, 400]);
  const reset = accumulate(second, "enp3s0", 300, 200, now + 120_000, 1);
  assert.deepEqual([reset.rxBytes, reset.txBytes], [1_100, 600]);
});

test("跨周期那一轮整段算进新周期", () => {
  let last = accumulate({}, "enp3s0", 1_000, 1_000, ms("2026-09-30T23:59:00"), 1);
  last = accumulate(last, "enp3s0", 2_000, 2_000, ms("2026-09-30T23:59:30"), 1);
  assert.equal(last.rxBytes, 1_000);
  const rolled = accumulate(last, "enp3s0", 2_500, 2_400, ms("2026-10-01T00:00:30"), 1);
  assert.equal(rolled.cycleStart, ms("2026-10-01T00:00:00"));
  assert.deepEqual([rolled.rxBytes, rolled.txBytes], [500, 400]);
});

test("推送账本：同一格累加、跨格新开、滑出窗口；起点不冒充满 12 小时", () => {
  const t0 = 1_790_200_200_000;
  let buckets = recordPush([], t0, 120);
  buckets = recordPush(buckets, t0 + 1_000, 80.4);
  buckets = recordPush(buckets, t0 + BUCKET_MS, 300);
  assert.deepEqual(countPushes(buckets, t0 + BUCKET_MS).pushes, 3);
  assert.ok(countPushes(buckets, t0 + BUCKET_MS).start <= t0);
  assert.equal(countPushes(buckets, t0 + LEDGER_WINDOW_MS + 2 * BUCKET_MS).pushes, 0);
  assert.deepEqual(recordPush(buckets, t0 + LEDGER_WINDOW_MS + 2 * BUCKET_MS, 50).map(([, rtts]) => rtts), [[50]]);
});

test("推送账本：RTT 取窗口内中位数，偶数封取中间两封的均值，没有样本为 null", () => {
  const t0 = 1_790_200_200_000;
  let buckets = recordPush([], t0, 120);
  buckets = recordPush(buckets, t0 + 1_000, 80.4);
  buckets = recordPush(buckets, t0 + BUCKET_MS, 300);
  assert.equal(countPushes(buckets, t0 + BUCKET_MS).rttMs, 120);
  buckets = recordPush(buckets, t0 + BUCKET_MS + 1_000, 200);
  assert.equal(countPushes(buckets, t0 + BUCKET_MS).rttMs, 160);
  assert.equal(countPushes([], t0).rttMs, null);
  // 滑出窗口的那几封不再参与
  assert.equal(countPushes(buckets, t0 + LEDGER_WINDOW_MS + BUCKET_MS).rttMs, 250);
});

test("CPU 占用与 AS 行解析", () => {
  assert.equal(cpuPercent([100, 1_000], [150, 1_100]), 50);
  assert.equal(cpuPercent([100, 1_000], [100, 1_000]), 0);
  assert.deepEqual(parseAs("AS142616 Misaka Network, Inc."), [142616, "Misaka Network, Inc."]);
  assert.deepEqual(parseAs("nope"), [null, null]);
});
