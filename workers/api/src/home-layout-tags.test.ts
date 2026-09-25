import assert from "node:assert/strict";
import test from "node:test";

import { SERVER_STALE_MS } from "@/lib/freshness";
import { installStorageForTests, resetStorageForTests } from "@/lib/storage";
import { STATUS_VIEWS } from "@/lib/status-views";
import { FakeStorage } from "@/lib/testing/fake-storage";
import { withRequestState } from "@shared/request-state";

import { collectIngestEffects, dispatchIngestEffects, type CollectedIngest } from "./ingest-effects";
import { commitPreparedIngest, prepareIngest } from "./ingest-handlers";
import { requestStore, type Env } from "./runtime";

/**
 * 首屏只在布局变了时失效（见 lib/home-layout）。每条都走完整的上报提交，
 * 看的是它交出来的 tags 效果，不看内部函数。
 */

const NOW = 1_800_000_000_000;

function testEnv(overrides: Partial<Env> = {}): Env {
  return {
    IMAGES: { head: async () => ({}) } as unknown as R2Bucket,
    LIVE_PUSH: {
      idFromName: () => null,
      get: () => ({ broadcast: async () => {} }),
    } as unknown as Env["LIVE_PUSH"],
    ...overrides,
  } as Env;
}

async function inRequest<T>(env: Env, run: () => Promise<T>): Promise<T> {
  const pending: Promise<unknown>[] = [];
  try {
    return await requestStore.run({
      env,
      ctx: { waitUntil: (promise) => { pending.push(promise); } },
    }, () => withRequestState(run));
  } finally {
    await Promise.allSettled(pending);
  }
}

async function land(env: Env, source: string, body: unknown, at: number): Promise<CollectedIngest<unknown>> {
  const command = await inRequest(env, () => prepareIngest(source, body, at));
  const result = await inRequest(env, () => collectIngestEffects(() => commitPreparedIngest(command)));
  assert.equal(result.ok, true, result.ok ? "" : result.error);
  return result;
}

function tagsOf(result: CollectedIngest<unknown>): string[] {
  return result.effects.flatMap((effect) => effect.kind === "tags" ? effect.tags : []);
}

function withStorage(run: () => Promise<void>) {
  return async () => {
    installStorageForTests(new FakeStorage());
    try { await run(); } finally { resetStorageForTests(); }
  };
}

function mac(modules: Record<string, unknown>, at: number) {
  return { version: 4, presence: "online", heartbeatAt: at, activeModules: ["charger"], modules };
}

function charger(connected: boolean, totalOutputW: number, at: number) {
  return mac({ chargingDevices: { devices: [
    { id: "charger", kind: "charger", connected, updatedAt: at, totalOutputW },
  ] } }, at);
}

test("充电头：插上和拔下失效首屏，插着时功率滚动不失效", withStorage(async () => {
  const env = testEnv();
  const tag = STATUS_VIEWS.charger.tag;
  assert.ok(tagsOf(await land(env, "mac", charger(true, 40, NOW), NOW)).includes(tag));
  assert.ok(!tagsOf(await land(env, "mac", charger(true, 41.37, NOW + 5_000), NOW + 5_000)).includes(tag));
  assert.ok(tagsOf(await land(env, "mac", charger(false, 0, NOW + 10_000), NOW + 10_000)).includes(tag));
}));

function server(partial: Record<string, unknown> = {}) {
  return {
    version: 1,
    id: "misaka-jp",
    hostname: "jp-1",
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
    traffic: null,
    uptimeSeconds: 3 * 86400,
    observedAt: NOW,
    ...partial,
  };
}

test("服务器：读数每轮都变也不失效；首报、流量行出现、断流后回来才失效", withStorage(async () => {
  const env = testEnv();
  const tag = STATUS_VIEWS.server.tag;
  assert.deepEqual(tagsOf(await land(env, "server", server(), NOW)), [tag]);
  assert.deepEqual(tagsOf(await land(env, "server", server({ cpuUsagePercent: 88.8, memoryUsedBytes: 900 * 1024 * 1024 }), NOW + 60_000)), []);
  const traffic = {
    cycleStart: 1_756_684_800_000,
    cycleEnd: 1_759_276_800_000,
    rxBytes: 324_000_000_000,
    txBytes: 118_000_000_000,
    quotaBytes: 1024 ** 4,
  };
  assert.deepEqual(tagsOf(await land(env, "server", server({ traffic }), NOW + 120_000)), [tag]);
  const back = NOW + 120_000 + SERVER_STALE_MS + 1;
  assert.deepEqual(tagsOf(await land(env, "server", server({ traffic }), back)), [tag]);
}));

function playing(positionTicks: number | null) {
  return {
    playing: positionTicks === null ? null : {
      itemId: "item-1",
      paused: false,
      positionTicks,
      runTimeTicks: 10 ** 15,
    },
  };
}

test("Emby：开播和停播失效首屏，进度更新不失效", withStorage(async () => {
  const env = testEnv();
  const tag = STATUS_VIEWS.nowWatching.tag;
  assert.ok(tagsOf(await land(env, "emby", playing(0), NOW)).includes(tag));
  assert.ok(!tagsOf(await land(env, "emby", playing(600_000_000), NOW + 60_000)).includes(tag));
  assert.ok(tagsOf(await land(env, "emby", playing(null), NOW + 120_000)).includes(tag));
}));

function limits(agents: { id: string; tier: string }[], at: number) {
  return {
    agents: agents.map(({ id, tier }) => ({ id, plan: { tier }, limits: [] })),
    collectedAt: new Date(at).toISOString(),
  };
}

test("Vibe coding：出口按卡片骨架比对上一次通知，行数变了才通知", withStorage(async () => {
  let revalidates = 0;
  const env = testEnv({ SITE_URL: "https://site.example", REVALIDATE_SECRET: "secret" } as Partial<Env>);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input) => {
    if (String(input) === "https://site.example/api/revalidate") {
      revalidates += 1;
      return Response.json({ ok: true });
    }
    throw new Error(`unexpected fetch ${String(input)}`);
  }) as typeof fetch;
  try {
    const dispatch = async (result: CollectedIngest<unknown>) => {
      assert.ok(tagsOf(result).includes(STATUS_VIEWS.vibeCoding.tag));
      await inRequest(env, () => dispatchIngestEffects(result.effects));
    };
    await dispatch(await land(env, "agents", limits([{ id: "codex", tier: "pro" }], NOW), NOW));
    assert.equal(revalidates, 1);
    // 限额内容变了，还是同一行：只刷内容，不失效首屏
    await dispatch(await land(env, "agents", limits([{ id: "codex", tier: "max" }], NOW + 1), NOW + 1));
    assert.equal(revalidates, 1);
    // 多出一行，卡片变高
    await dispatch(await land(env, "agents", limits([{ id: "claude", tier: "max" }], NOW + 2), NOW + 2));
    assert.equal(revalidates, 2);
  } finally {
    globalThis.fetch = originalFetch;
  }
}));
