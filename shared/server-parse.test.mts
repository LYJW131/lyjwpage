import assert from "node:assert/strict";
import test from "node:test";

import { normalizeServer } from "./server-parse.ts";

function valid() {
  return {
    version: 1,
    id: "misaka-jp",
    hostname: "  misaka  ",
    publicIp: "203.0.113.10",
    country: "JP",
    city: null,
    isp: "NTT",
    asn: 2914,
    asnOrg: "NTT Communications",
    os: "Linux",
    kernel: "6.1.0",
    cpuCores: 4,
    cpuUsagePercent: 55.55,
    load1: 1.234,
    load5: 0.567,
    load15: 0,
    memoryTotalBytes: 8_000_000_000,
    memoryUsedBytes: 4_000_000_000,
    memoryAvailableBytes: 4_000_000_000,
    diskTotalBytes: 500_000_000_000,
    diskUsedBytes: 250_000_000_000,
    networkInterface: "eth0",
    networkRxBytes: 1_000_000,
    networkTxBytes: 2_000_000,
    networkRxBytesPerSec: 123.6,
    networkTxBytesPerSec: 45.4,
    traffic: {
      cycleStart: 1_700_000_000_000,
      cycleEnd: 1_702_592_000_000,
      rxBytes: 10.6,
      txBytes: 20.4,
      quotaBytes: null,
    },
    uptimeSeconds: 3600.7,
    observedAt: 1_700_000_100_000,
  };
}

test("合法上报规整为公开形状：字符串去空白、百分比留一位、速率与流量取整，version 不进入输出", () => {
  assert.deepEqual(normalizeServer(valid()), {
    id: "misaka-jp",
    hostname: "misaka",
    publicIp: "203.0.113.10",
    country: "JP",
    city: null,
    isp: "NTT",
    asn: 2914,
    asnOrg: "NTT Communications",
    os: "Linux",
    kernel: "6.1.0",
    cpuCores: 4,
    cpuUsagePercent: 55.6,
    load1: 1.23,
    load5: 0.57,
    load15: 0,
    memoryTotalBytes: 8_000_000_000,
    memoryUsedBytes: 4_000_000_000,
    memoryAvailableBytes: 4_000_000_000,
    diskTotalBytes: 500_000_000_000,
    diskUsedBytes: 250_000_000_000,
    networkInterface: "eth0",
    networkRxBytes: 1_000_000,
    networkTxBytes: 2_000_000,
    networkRxBytesPerSec: 124,
    networkTxBytesPerSec: 45,
    traffic: {
      cycleStart: 1_700_000_000_000,
      cycleEnd: 1_702_592_000_000,
      rxBytes: 11,
      txBytes: 20,
      quotaBytes: null,
    },
    uptimeSeconds: 3601,
    observedAt: 1_700_000_100_000,
  });
});

test("cpuUsagePercent 上限钉到 100", () => {
  assert.equal(normalizeServer({ ...valid(), cpuUsagePercent: 145 }).cpuUsagePercent, 100);
});

test("version 缺或不是 1 都拒收；非对象输入也一样", () => {
  assert.throws(() => normalizeServer({ ...valid(), version: 2 }), /version 必须为 1/);
  assert.throws(() => normalizeServer({ ...valid(), version: "1" }), /version 必须为 1/);
  assert.throws(() => normalizeServer(null), /JSON 对象/);
  assert.throws(() => normalizeServer("x"), /JSON 对象/);
  assert.throws(() => normalizeServer([]), /JSON 对象/);
});

test("必填字符串缺失或空白都拒收", () => {
  const missing = valid() as Record<string, unknown>;
  delete missing.hostname;
  assert.throws(() => normalizeServer(missing), /hostname 必须是非空字符串/);
  assert.throws(() => normalizeServer({ ...valid(), id: "   " }), /id 必须是非空字符串/);
  assert.throws(() => normalizeServer({ ...valid(), os: 7 }), /os 必须是非空字符串/);
});

test("publicIp 只收 IPv4 字面量", () => {
  assert.throws(() => normalizeServer({ ...valid(), publicIp: "999.1.1.1" }), /IPv4/);
  assert.throws(() => normalizeServer({ ...valid(), publicIp: "::1" }), /IPv4/);
  assert.throws(() => normalizeServer({ ...valid(), publicIp: "nas.internal" }), /IPv4/);
  assert.equal(normalizeServer({ ...valid(), publicIp: "255.255.255.255" }).publicIp, "255.255.255.255");
});

test("可空字段：键必须在，可以是 null", () => {
  const missing = valid() as Record<string, unknown>;
  delete missing.country;
  assert.throws(() => normalizeServer(missing), /缺少 country/);
  const row = { ...valid(), country: null, asnOrg: null };
  assert.equal(normalizeServer(row).country, null);
});

test("asn 必须是正整数或 null", () => {
  const missing = valid() as Record<string, unknown>;
  delete missing.asn;
  assert.throws(() => normalizeServer(missing), /缺少 asn/);
  assert.throws(() => normalizeServer({ ...valid(), asn: 0 }), /正整数或 null/);
  assert.throws(() => normalizeServer({ ...valid(), asn: 2.5 }), /正整数或 null/);
  assert.throws(() => normalizeServer({ ...valid(), asn: "2914" }), /正整数或 null/);
  assert.equal(normalizeServer({ ...valid(), asn: null }).asn, null);
});

test("用量不能超过总量；总量必须大于 0", () => {
  assert.throws(
    () => normalizeServer({ ...valid(), memoryUsedBytes: 8_000_000_001 }),
    /memoryUsedBytes 不能大于 memoryTotalBytes/,
  );
  assert.throws(
    () => normalizeServer({ ...valid(), memoryAvailableBytes: 9_000_000_000 }),
    /memoryAvailableBytes 不能大于 memoryTotalBytes/,
  );
  assert.throws(() => normalizeServer({ ...valid(), memoryTotalBytes: 0 }), /memoryTotalBytes 必须大于 0/);
  assert.throws(
    () => normalizeServer({ ...valid(), diskUsedBytes: 500_000_000_001 }),
    /diskUsedBytes 不能大于 diskTotalBytes/,
  );
});

test("整数与正数约束：cpuCores 取整数值，observedAt 要 epoch 毫秒整数，负数一律拒", () => {
  assert.throws(() => normalizeServer({ ...valid(), cpuCores: 2.5 }), /cpuCores 必须是正整数/);
  assert.throws(() => normalizeServer({ ...valid(), cpuCores: 0 }), /cpuCores 必须大于 0/);
  assert.throws(() => normalizeServer({ ...valid(), observedAt: 1_700_000_000_000.5 }), /observedAt 必须是 epoch 毫秒整数/);
  assert.throws(() => normalizeServer({ ...valid(), observedAt: -1 }), /observedAt 不能为负/);
  assert.throws(() => normalizeServer({ ...valid(), load1: -0.1 }), /load1 不能为负/);
  assert.throws(() => normalizeServer({ ...valid(), cpuUsagePercent: Number.NaN }), /cpuUsagePercent 必须是数字/);
});

test("traffic：null 原样通过；周期边界必须是整数且 end 晚于 start", () => {
  assert.equal(normalizeServer({ ...valid(), traffic: null }).traffic, null);
  assert.throws(() => normalizeServer({ ...valid(), traffic: 5 }), /traffic 必须是对象或 null/);
  const reversed = { ...valid(), traffic: { cycleStart: 200, cycleEnd: 100, rxBytes: 0, txBytes: 0, quotaBytes: null } };
  assert.throws(() => normalizeServer(reversed), /cycleEnd 必须晚于 cycleStart/);
  const floatStart = { ...valid(), traffic: { cycleStart: 1.5, cycleEnd: 2, rxBytes: 0, txBytes: 0, quotaBytes: null } };
  assert.throws(() => normalizeServer(floatStart), /周期边界必须是 epoch 毫秒整数/);
});

test("traffic.quotaBytes：null 表示不限量，给值必须是正数", () => {
  const row = { ...valid(), traffic: { cycleStart: 1, cycleEnd: 2, rxBytes: 0, txBytes: 0, quotaBytes: 500_000_000_000 } };
  assert.equal(normalizeServer(row).traffic?.quotaBytes, 500_000_000_000);
  const zero = { ...valid(), traffic: { cycleStart: 1, cycleEnd: 2, rxBytes: 0, txBytes: 0, quotaBytes: 0 } };
  assert.throws(() => normalizeServer(zero), /quotaBytes 必须大于 0/);
});
