import assert from "node:assert/strict";
import test from "node:test";

import { SERVER_STALE_MS } from "@/lib/freshness";
import { STATUS_VIEWS } from "@/lib/status-views";
import { MemoryKv } from "@/lib/testing/memory-kv";
import type { AgentLimitsPayload } from "@/lib/vibecoding-limits";
import { LAG_KEYS, readLag } from "@shared/lag";

import { prepareIngest } from "@shared/ingest/prepare";
import { commitLagIngest } from "./lag-ingest";

const NOW = 1_800_000_000_000;

function server(partial: Record<string, unknown> = {}) {
  return {
    version: 1,
    id: "misaka-jp",
    hostname: "misaka-jp",
    publicIp: "203.0.113.7",
    country: null,
    city: null,
    isp: null,
    asn: null,
    asnOrg: null,
    os: "Debian",
    kernel: "6.1",
    cpuCores: 2,
    cpuUsagePercent: 12.3,
    load1: 0.1,
    load5: 0.1,
    load15: 0.1,
    memoryTotalBytes: 2 * 1024 ** 3,
    memoryUsedBytes: 1024 ** 3,
    memoryAvailableBytes: 1024 ** 3,
    diskTotalBytes: 20 * 1024 ** 3,
    diskUsedBytes: 5 * 1024 ** 3,
    networkInterface: "eth0",
    networkRxBytes: 1,
    networkTxBytes: 1,
    networkRxBytesPerSec: 1,
    networkTxBytesPerSec: 1,
    traffic: null,
    uptimeSeconds: 100,
    observedAt: NOW,
    ...partial,
  };
}

async function land(kv: MemoryKv, source: string, body: unknown, at: number) {
  return commitLagIngest(kv, await prepareIngest(source, body, at));
}

test("服务器：每封重写读数与更新时刻；首报、流量行出现、断流后回来才失效首屏", async () => {
  const kv = new MemoryKv();
  const tag = STATUS_VIEWS.server.tag;
  assert.deepEqual(await land(kv, "server", server(), NOW), [tag]);
  assert.deepEqual(await land(kv, "server", server({ cpuUsagePercent: 88.8 }), NOW + 60_000), []);
  const stored = await readLag<{ cpuUsagePercent: number; pushedAt: number }>(kv, LAG_KEYS.server);
  assert.equal(stored?.data.cpuUsagePercent, 88.8);
  assert.equal(stored?.data.pushedAt, NOW + 60_000);
  assert.equal(stored?.updatedAt, NOW + 60_000);
  const traffic = { cycleStart: NOW - 86_400_000, cycleEnd: NOW + 86_400_000, rxBytes: 1, txBytes: 1, quotaBytes: null };
  assert.deepEqual(await land(kv, "server", server({ traffic }), NOW + 120_000), [tag]);
  assert.deepEqual(await land(kv, "server", server({ traffic }), NOW + 120_000 + SERVER_STALE_MS + 1), [tag]);
});

test("常驻上报器的账本各写一条，块写坏或没带就不写", async () => {
  const kv = new MemoryKv();
  const reporter = { commit: "abc1234", pushes: 3, rttMs: 120, start: NOW - 3_600_000, end: NOW };
  await land(kv, "server", { ...server(), reporter }, NOW);
  assert.deepEqual((await readLag(kv, LAG_KEYS.reporterServer))?.data, { ...reporter, lastPushAt: NOW });
  await land(kv, "server", { ...server(), reporter: { pushes: "many" } }, NOW + 60_000);
  assert.equal((await readLag(kv, LAG_KEYS.reporterServer))?.updatedAt, NOW);
  assert.equal(await readLag(kv, LAG_KEYS.reporterAgents), null);
});

function limits(agents: { id: string; tier: string }[], at: number) {
  return {
    agents: agents.map(({ id, tier }) => ({ id, plan: { tier }, limits: [] })),
    collectedAt: new Date(at).toISOString(),
  };
}

test("限额按 id 合并写回；只有来源集合变了才失效首屏", async () => {
  const kv = new MemoryKv();
  const tag = STATUS_VIEWS.limits.tag;
  assert.deepEqual(await land(kv, "agents", limits([{ id: "codex", tier: "pro" }], NOW), NOW), [tag]);
  assert.deepEqual(await land(kv, "agents", limits([{ id: "codex", tier: "max" }], NOW + 1), NOW + 1), []);
  assert.deepEqual(await land(kv, "agents", limits([{ id: "claude", tier: "max" }], NOW + 2), NOW + 2), [tag]);
  const stored = await readLag<AgentLimitsPayload>(kv, LAG_KEYS.limits);
  assert.deepEqual(Object.keys(stored?.data.agents ?? {}).sort(), ["claude", "codex"]);
  assert.equal(stored?.data.agents.codex?.updatedAt, NOW + 1);
  assert.equal(stored?.updatedAt, NOW + 2);
});

test("只带 cursorNow 的 agents 信封不碰限额", async () => {
  const kv = new MemoryKv();
  await land(kv, "agents", limits([{ id: "cursor", tier: "Ultra" }], NOW), NOW);
  const before = kv.values.get(LAG_KEYS.limits);
  await land(kv, "agents", {
    collectedAt: new Date(NOW + 60_000).toISOString(),
    cursorNow: { lastActivityAt: new Date(NOW + 30_000).toISOString(), currentModel: "grok" },
  }, NOW + 60_000);
  assert.equal(kv.values.get(LAG_KEYS.limits), before);
});

function mac(activeModules: string[], modules: Record<string, unknown>, at: number) {
  return { version: 4, presence: "online", heartbeatAt: at, activeModules, modules };
}

test("时区只在模块带来时重写，模块关掉后写成 null 一次", async () => {
  const kv = new MemoryKv();
  const timezone = { identifier: "Asia/Tokyo", secondsFromGMT: 32_400 };
  assert.deepEqual(await land(kv, "mac", mac(["timezone"], { timezone }, NOW), NOW), []);
  const stored = await readLag<{ timezone: { identifier: string } | null }>(kv, LAG_KEYS.timezone);
  assert.equal(stored?.data.timezone?.identifier, "Asia/Tokyo");
  const writes = kv.writes;
  await land(kv, "mac", mac(["timezone"], {}, NOW + 30_000), NOW + 30_000);
  assert.equal(kv.writes, writes, "纯心跳不重写时区");
  await land(kv, "mac", mac([], {}, NOW + 60_000), NOW + 60_000);
  assert.equal((await readLag<{ timezone: unknown }>(kv, LAG_KEYS.timezone))?.data.timezone, null);
  const afterNull = kv.writes;
  await land(kv, "mac", mac([], {}, NOW + 90_000), NOW + 90_000);
  assert.equal(kv.writes, afterNull, "已经是 null 就不再写");
});

const rings = {
  date: "2026-09-29", secondsFromGMT: 28_800,
  moveKcal: 320, moveGoalKcal: 400, exerciseMinutes: 12, exerciseGoalMinutes: 30,
  standHours: 6, standGoalHours: 12, steps: 5_400,
};

test("iPhone：圆环读数写进可滞后层，只带历史桶的上报不碰它，圆环卡不失效首屏", async () => {
  const kv = new MemoryKv();
  assert.deepEqual(await land(kv, "iphone", { version: 1, modules: { activity: rings } }, NOW), []);
  const stored = await readLag<{ moveKcal: number; date: string }>(kv, LAG_KEYS.activity);
  assert.deepEqual([stored?.data.moveKcal, stored?.data.date, stored?.updatedAt], [320, "2026-09-29", NOW]);
  const bucketEnd = Math.floor(NOW / 300_000) * 300_000;
  await land(kv, "iphone", { version: 1, modules: { activity: {
    history: { from: bucketEnd - 300_000, to: bucketEnd, buckets: [{ from: bucketEnd - 300_000, to: bucketEnd, steps: 10 }] },
  } } }, NOW + 60_000);
  assert.equal((await readLag(kv, LAG_KEYS.activity))?.updatedAt, NOW, "updatedAt is the report that last carried the rings");
  assert.equal(kv.values.has(LAG_KEYS.workouts), false, "a report without workouts leaves the list alone");
});

test("iPhone：训练收下、圆环被拒的那封，可滞后层只写训练列表，和状态核心收下的口径一致", async () => {
  const kv = new MemoryKv();
  const workout = {
    id: "11111111-1111-4111-8111-111111111111",
    activityType: "Running",
    startedAt: NOW - 3_600_000,
    endedAt: NOW - 1_800_000,
    durationSeconds: 1_500,
    secondsFromGMT: 0,
  };
  const command = await prepareIngest("iphone", { version: 1, modules: { workouts: { items: [workout] }, activity: { date: "bad" } } }, NOW);
  assert.equal(command.source === "iphone" && command.failure?.stage, "beforeActivity");
  await commitLagIngest(kv, command);
  assert.equal((await readLag<{ items: { activityType: string }[] }>(kv, LAG_KEYS.workouts))?.data.items[0]?.activityType, "Running");
  assert.equal(kv.values.has(LAG_KEYS.activity), false, "被拒的圆环不进可滞后层");
});
