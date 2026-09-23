import assert from "node:assert/strict";
import test from "node:test";

import { normalizeServer } from "./server-parse.ts";

function report(partial: Record<string, unknown> = {}) {
  return {
    version: 1,
    id: "misaka-jp",
    hostname: "jp-nrt04-s3n-1c2g-1",
    publicIp: "103.170.233.241",
    country: "Japan",
    city: "Tokyo",
    isp: "Misaka Network, Inc.",
    asn: 142616,
    asnOrg: "Misaka Network, Inc.",
    os: "Ubuntu 26.04 LTS",
    kernel: "7.0.0-30-generic",
    cpuCores: 1,
    cpuUsagePercent: 12.34,
    load1: 0.16,
    load5: 0.15,
    load15: 0.1,
    memoryTotalBytes: 2048 * 1024 * 1024,
    memoryUsedBytes: 612 * 1024 * 1024,
    memoryAvailableBytes: 1400 * 1024 * 1024,
    diskTotalBytes: 30 * 1024 * 1024 * 1024,
    diskUsedBytes: 3 * 1024 * 1024 * 1024,
    networkInterface: "enp3s0",
    networkRxBytes: 28_723_774_277,
    networkTxBytes: 26_507_550_253,
    networkRxBytesPerSec: 123_456.7,
    networkTxBytesPerSec: 45_000,
    traffic: {
      cycleStart: 1_756_684_800_000,
      cycleEnd: 1_759_276_800_000,
      rxBytes: 324_000_000_000,
      txBytes: 118_000_000_000,
      quotaBytes: 1024 ** 4,
    },
    uptimeSeconds: 3 * 86400 + 3600,
    observedAt: 1_700_000_000_000,
    ...partial,
  };
}

test("合法报文收成对外契约，百分比和速率按约定取整", () => {
  const status = normalizeServer(report());
  assert.equal(status.id, "misaka-jp");
  assert.equal(status.publicIp, "103.170.233.241");
  assert.equal(status.asn, 142616);
  assert.equal(status.cpuUsagePercent, 12.3);
  assert.equal(status.load15, 0.1);
  assert.equal(status.networkRxBytesPerSec, 123457);
  assert.equal(status.uptimeSeconds, 3 * 86400 + 3600);
});

test("公网 IP 必须是 IPv4，geo 字段可以是 null", () => {
  assert.throws(() => normalizeServer(report({ publicIp: "not-an-ip" })), /publicIp/);
  const empty = normalizeServer(
    report({ country: null, city: null, isp: null, asn: null, asnOrg: null }),
  );
  assert.equal(empty.country, null);
  assert.equal(empty.asn, null);
});

test("CPU 略超 100 是浮点噪声，夹紧而不是整封打回", () => {
  assert.equal(normalizeServer(report({ cpuUsagePercent: 100.04 })).cpuUsagePercent, 100);
});

test("version 必须是 1，缺了或写错都不收", () => {
  assert.throws(() => normalizeServer(report({ version: 2 })), /version/);
  const missingVersion: Record<string, unknown> = report();
  delete missingVersion.version;
  assert.throws(() => normalizeServer(missingVersion), /version/);
});

test("内存、磁盘用量不能大于总量", () => {
  assert.throws(
    () => normalizeServer(report({ memoryUsedBytes: 9e18 })),
    /memoryUsedBytes/,
  );
  assert.throws(
    () => normalizeServer(report({ diskUsedBytes: 9e18 })),
    /diskUsedBytes/,
  );
});

test("observedAt 必须是 epoch 毫秒整数", () => {
  assert.throws(() => normalizeServer(report({ observedAt: 1.5 })), /observedAt/);
  assert.throws(() => normalizeServer(report({ observedAt: 0 })), /observedAt/);
});

test("空字符串和负数都拒", () => {
  assert.throws(() => normalizeServer(report({ id: "  " })), /id/);
  assert.throws(() => normalizeServer(report({ load1: -0.1 })), /load1/);
  assert.throws(() => normalizeServer(report({ cpuCores: 0 })), /cpuCores/);
});

test("周期流量整块跟着收，配额可以没有", () => {
  const status = normalizeServer(report());
  assert.equal(status.traffic?.rxBytes, 324_000_000_000);
  assert.equal(status.traffic?.quotaBytes, 1024 ** 4);

  const free = normalizeServer(
    report({ traffic: { ...report().traffic, quotaBytes: null } }),
  );
  assert.equal(free.traffic?.quotaBytes, null);
});

test("攒不出流量的节点报 null / 不报，其余字段照收", () => {
  assert.equal(normalizeServer(report({ traffic: null })).traffic, null);
  const missing: Record<string, unknown> = report();
  delete missing.traffic;
  const status = normalizeServer(missing);
  assert.equal(status.traffic, null);
  // 少这一块不该连 CPU 一起打回
  assert.equal(status.cpuUsagePercent, 12.3);
});

test("给了流量就得是完整一份，缺项、负数、周期倒着走都不收", () => {
  const { traffic } = report();
  const broken = (partial: Record<string, unknown>) => () =>
    normalizeServer(report({ traffic: { ...traffic, ...partial } }));

  assert.throws(broken({ rxBytes: undefined }), /rxBytes/);
  assert.throws(broken({ rxBytes: -1 }), /rxBytes/);
  assert.throws(broken({ cycleEnd: traffic.cycleStart }), /cycleEnd/);
  assert.throws(broken({ cycleEnd: traffic.cycleStart - 1 }), /cycleEnd/);
  assert.throws(broken({ cycleStart: 1.5 }), /epoch/);
  assert.throws(broken({ quotaBytes: 0 }), /quotaBytes/);
  assert.throws(() => normalizeServer(report({ traffic: "1TB" })), /traffic/);
});

test("12 小时窗口：旧版不带按 null 收，带了就要合法", () => {
  assert.equal(normalizeServer(report()).window, null);
  const fresh = normalizeServer(report({
    window: { start: 1_790_000_000_000, end: 1_790_043_200_000, cpuAvgPercent: 4.26 },
    reporter: { commit: "b15e3cc", pushes: 3, start: 1, end: 2 },
  }));
  assert.deepEqual(fresh.window, { start: 1_790_000_000_000, end: 1_790_043_200_000, cpuAvgPercent: 4.3 });
  // 账本归 lib/reporter-ledger 管，不进服务器快照
  assert.equal("reporter" in fresh, false);
  assert.throws(() => normalizeServer(report({ window: { start: 2, end: 1 } })), /window/);
});
