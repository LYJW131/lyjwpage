import assert from "node:assert/strict";
import test from "node:test";

import { PULSE_REPEAT_AFTER_MS } from "@/lib/limits";
import { codingObservationsKey, cursorObservationsKey } from "@/lib/coding-pulse";
import {
  pulseActivityKey,
  pulseActivityRevisionKey,
  pulseChargingKey,
  pulseLaneKey,
  pulseLaneOpenKey,
  pulseListeningTracesKey,
  pulseWorkoutsKey,
} from "@/lib/pulse-keys";
import { recordAgentLimits } from "@api/stores/vibecoding";
import { commitRecentlyPlayed } from "@api/apple-music-recent";
import { installStorageForTests, resetStorageForTests } from "@/lib/storage";
import { FakeStorage } from "@/lib/testing/fake-storage";
import { withRequestState } from "@shared/request-state";
import type { StateLane } from "@shared/pulse-timeline";
import { requestStore, type Env } from "@api/runtime";
import { recordEmbyReport } from "@api/stores/emby";
import { recordPlaystationReport } from "@api/stores/playstation";
import { recordTelemetryEnvelope } from "@api/stores/telemetry";
import type { ListeningItem } from "@/lib/types";

/**
 * Pulse 的挂钩点，按信封驱动：哪一封该落笔、落成什么样的区间或样本。
 * 区间规则本身由 src/lib/pulse-timeline.test.mts 的纯函数测试守着。
 */

const T0 = 1_760_000_000_000;

/**
 * 一次上报的作用域。
 *
 * `requestStore` 是必需的：fanout 的失效通知会问 `currentContext()`，没有作用域时
 * 它抛出去的错会盖住真正要看的断言。`waitUntil` 收下的后台任务在这里等干净，
 * 免得跨测试互相干扰。
 */
async function inRequest<T>(run: () => Promise<T>): Promise<T> {
  const pending: Promise<unknown>[] = [];
  const context = {
    // 广播那一路不是这几个测试要看的东西，给个不出声的房间，免得日志里全是 [live]
    env: {
      LIVE_PUSH: {
        idFromName: () => null,
        get: () => ({ broadcast: async () => {} }),
      },
    } as unknown as Env,
    ctx: {
      waitUntil: (promise: Promise<unknown>) => {
        pending.push(promise);
      },
    },
  };
  try {
    return await requestStore.run(context, () => withRequestState(run));
  } finally {
    await Promise.allSettled(pending);
  }
}

async function closed(storage: FakeStorage, lane: StateLane) {
  return (await storage.listRange(pulseLaneKey(lane), 0, -1)).map((row) => JSON.parse(row));
}
async function open(storage: FakeStorage, lane: StateLane) {
  const raw = await storage.get(pulseLaneOpenKey(lane));
  return raw ? JSON.parse(raw) : null;
}

function envelope(at: number, activeModules: string[], modules?: Record<string, unknown>) {
  return { version: 4, presence: "online", heartbeatAt: at, activeModules, modules };
}

function music(state: "playing" | "paused", observedAt: number, title = "Helpless") {
  return { state, title, artist: "Hamilton", album: "Hamilton (Original Broadway Cast Recording)", positionMs: 0, durationMs: 180_000, observedAt };
}

const helpless = { source: "mac", title: "Helpless", artist: "Hamilton", album: "Hamilton (Original Broadway Cast Recording)", trackId: null };

function withStorage(run: (storage: FakeStorage) => Promise<void>) {
  return async () => {
    const storage = new FakeStorage();
    installStorageForTests(storage);
    try { await run(storage); } finally { resetStorageForTests(); }
  };
}

test("Mac 心跳续同一段在听，每分钟最多写一次；换曲关上旧段", withStorage(async (storage) => {
  await inRequest(() => recordTelemetryEnvelope(envelope(T0, ["appleMusic"], { appleMusic: music("playing", T0) }), T0));
  assert.deepEqual(await open(storage, "listening"), { state: "playing", ...helpless, from: T0, seenAt: T0 });

  // 心跳不带任何模块 —— 采集端只在内容变化时才带，这一封说的是「还在放同一首」
  await inRequest(() => recordTelemetryEnvelope(envelope(T0 + 30_000, ["appleMusic"]), T0 + 30_000));
  assert.equal((await open(storage, "listening")).seenAt, T0, "less than a minute: no write");
  await inRequest(() => recordTelemetryEnvelope(envelope(T0 + 60_000, ["appleMusic"]), T0 + 60_000));
  assert.equal((await open(storage, "listening")).seenAt, T0 + 60_000);

  const next = T0 + 180_000;
  await inRequest(() => recordTelemetryEnvelope(envelope(next, ["appleMusic"], { appleMusic: music("playing", next, "Satisfied") }), next));
  assert.deepEqual(await closed(storage, "listening"), [{ state: "playing", ...helpless, from: T0, to: next }]);
  assert.equal((await open(storage, "listening")).title, "Satisfied");
}));

test("暂停是事实，不套首页的 10 秒宽限；停掉之后是空闲", withStorage(async (storage) => {
  await inRequest(() => recordTelemetryEnvelope(envelope(T0, ["appleMusic"], { appleMusic: music("paused", T0) }), T0));
  const later = T0 + 5 * 60_000;
  await inRequest(() => recordTelemetryEnvelope(envelope(later, ["appleMusic"]), later));
  assert.equal((await open(storage, "listening")).state, "paused", "a paused Music app stays paused");
  const stopped = later + 60_000;
  await inRequest(() => recordTelemetryEnvelope(envelope(stopped, ["appleMusic"], { appleMusic: { ...music("paused", stopped), state: "stopped" } }), stopped));
  assert.deepEqual((await closed(storage, "listening")).map((row) => [row.state, row.from, row.to]), [["paused", T0, stopped]]);
  assert.deepEqual(await open(storage, "listening"), { state: "idle", source: null, title: null, artist: null, album: null, trackId: null, from: stopped, seenAt: stopped });
}));

test("Mac 下线又没有 HomePod：开着的那段到此为止，之后是未知", withStorage(async (storage) => {
  await inRequest(() => recordTelemetryEnvelope(envelope(T0, ["appleMusic"], { appleMusic: music("playing", T0) }), T0));
  const off = T0 + 90_000;
  await inRequest(() => recordTelemetryEnvelope({ ...envelope(off, ["appleMusic"]), presence: "offline" }, off));
  assert.deepEqual((await closed(storage, "listening")).map((row) => [row.state, row.from, row.to]), [["playing", T0, off]]);
  assert.equal(await open(storage, "listening"), null);
}));

test("desktop 模块关掉后，留着的前台应用不再被记成 coding", withStorage(async (storage) => {
  await inRequest(() => recordTelemetryEnvelope(envelope(T0, ["desktop"], {
    desktop: { applicationName: "Cursor", bundleIdentifier: "com.todesktop.230313mzl4w4u92" },
  }), T0));
  const off = T0 + 60_000;
  await inRequest(() => recordTelemetryEnvelope(envelope(off, ["vibeCoding"], {
    vibeCodingNow: { agents: [{ id: "claude", currentModel: "opus", active: false }] },
  }), off));
  const rows = (await storage.listRange(codingObservationsKey(), 0, -1)).map((raw) => JSON.parse(raw));
  assert.deepEqual(rows.map((row) => row.desktop), [{ application: "Cursor", coding: true }, null]);
  assert.equal(await storage.get(pulseLaneOpenKey("listening")), null, "no appleMusic module means listening is not observed");
}));

test("vibeCoding 模块关掉或采集器过期后，留着的 agents 不再进观测", withStorage(async (storage) => {
  await inRequest(() => recordTelemetryEnvelope(envelope(T0, ["vibeCoding"], {
    vibeCodingNow: { agents: [{ id: "claude", currentModel: "opus", active: true }] },
  }), T0));
  const again = T0 + 6 * 60_000;
  await inRequest(() => recordTelemetryEnvelope(envelope(again, ["vibeCoding"]), again));
  const stale = T0 + 16 * 60_000;
  await inRequest(() => recordTelemetryEnvelope(envelope(stale, ["vibeCoding"]), stale));
  const rows = (await storage.listRange(codingObservationsKey(), 0, -1)).map((raw) => JSON.parse(raw));
  assert.deepEqual(rows.map((row) => row.agents?.[0]?.active ?? null), [true, true, null]);
  assert.equal(rows[2].available, false);
}));

test("Coding observations keep foreground changes and idle heartbeats, and stop on explicit offline", withStorage(async (storage) => {
  await inRequest(() => recordTelemetryEnvelope(envelope(T0, ["desktop", "vibeCoding"], {
    desktop: { applicationName: "Cursor", bundleIdentifier: "com.todesktop.230313mzl4w4u92" },
    vibeCodingNow: { agents: [{ id: "codex", currentModel: "test-model", active: true }] },
  }), T0));
  await inRequest(() => recordTelemetryEnvelope(envelope(T0 + 20_000, ["desktop", "vibeCoding"], {
    desktop: { applicationName: "Zed", bundleIdentifier: "dev.zed.Zed" },
  }), T0 + 20_000));
  await inRequest(() => recordTelemetryEnvelope(envelope(T0 + 110_000, ["desktop", "vibeCoding"]), T0 + 110_000));
  await inRequest(() => recordTelemetryEnvelope({ ...envelope(T0 + 120_000, ["desktop", "vibeCoding"]), presence: "offline" }, T0 + 120_000));
  const rows = (await storage.listRange(codingObservationsKey(), 0, -1)).map((raw) => JSON.parse(raw));
  assert.equal(rows.length, 4);
  assert.equal(rows[0].desktop.application, "Cursor");
  assert.equal(rows[1].desktop.application, "Zed");
  assert.equal(rows[2].agents[0].active, true);
  assert.equal(rows[3].available, false);
}));

test("充电头只发心跳的那几分钟，瓦数照样 5 分钟再确认一次", withStorage(async (storage) => {
  const charger = (at: number, watts: number) => envelope(at, ["charger"], {
    chargingDevices: { devices: [{
      id: "sn-1", kind: "charger", model: "A2687", connected: true, updatedAt: at, totalOutputW: watts,
      ports: [{ name: "C1", active: true, powerW: watts, attachedDevice: { model: "MacBook Pro" } }],
    }] },
  });
  await inRequest(() => recordTelemetryEnvelope(charger(T0, 45.04), T0));
  const samples = async () => (await storage.listRange(pulseChargingKey(), 0, -1)).map((raw) => JSON.parse(raw));
  assert.deepEqual(await samples(), [{ t: T0, watts: 45, device: "MacBook Pro" }]);
  // 30 秒内的小幅波动不写
  await inRequest(() => recordTelemetryEnvelope(charger(T0 + 20_000, 46), T0 + 20_000));
  assert.equal((await samples()).length, 1);
  // 这一封没带 chargingDevices，只把 charger 列在 activeModules 里（走 prepareHeartbeat）
  const reconfirm = T0 + PULSE_REPEAT_AFTER_MS;
  await inRequest(() => recordTelemetryEnvelope(envelope(reconfirm, ["charger"]), reconfirm));
  assert.deepEqual((await samples()).map((row) => row.t), [T0, reconfirm]);
}));

test("Emby：位置更新沿用存着的标题，itemId 对不上不借标题，明确停播后一直是空闲", withStorage(async (storage) => {
  await inRequest(() => recordEmbyReport({ playing: {
    itemId: "42", paused: false, positionTicks: 0, runTimeTicks: 36_000_000_000,
    item: { id: "42", name: "Frieren", type: "Series" },
  } }, T0));
  const paused = T0 + 30_000;
  await inRequest(() => recordEmbyReport({ playing: { itemId: "42", paused: true, positionTicks: 1, runTimeTicks: 36_000_000_000 } }, paused));
  assert.deepEqual(await closed(storage, "watching"), [{ state: "playing", itemId: "42", title: "Frieren", subtitle: null, from: T0, to: paused }]);
  assert.equal((await open(storage, "watching")).title, "Frieren");

  const other = paused + 30_000;
  await inRequest(() => recordEmbyReport({ playing: { itemId: "77", paused: false, positionTicks: 0, runTimeTicks: 36_000_000_000 } }, other));
  assert.deepEqual(await open(storage, "watching"), { state: "playing", itemId: "77", title: null, subtitle: null, from: other, seenAt: other });

  const stop = other + 60_000;
  await inRequest(() => recordEmbyReport({ playing: null }, stop));
  assert.equal((await open(storage, "watching")).state, "idle");
  // 空闲没有有效期：几个小时后再开播，中间整段都是观测到的空闲
  const resume = stop + 5 * 3_600_000;
  await inRequest(() => recordEmbyReport({ playing: { itemId: "42", paused: false, positionTicks: 2, runTimeTicks: 36_000_000_000 } }, resume));
  assert.deepEqual((await closed(storage, "watching")).at(-1), { state: "idle", itemId: null, title: null, subtitle: null, from: stop, to: resume });
}));

test("PSN 在线状态：进游戏、换游戏、下线各是一段", withStorage(async (storage) => {
  const presence = (at: number, online: boolean, playing: { titleId: string; title: string } | null) =>
    ({ version: 1, presence: { observedAt: at, online, availability: null, platform: "PS5", lastOnlineAt: null,
      playing: playing && { ...playing, format: null, launchPlatform: null, iconUrl: null } } });
  await inRequest(() => recordPlaystationReport(presence(T0, true, null), T0));
  const game = T0 + 20 * 60_000;
  await inRequest(() => recordPlaystationReport(presence(game, true, { titleId: "PPSA01", title: "Pragmata" }), game));
  // PSN 没人看时半小时才查一次：34 分钟后的同一状态仍是同一段
  await inRequest(() => recordPlaystationReport(presence(game + 34 * 60_000, true, { titleId: "PPSA01", title: "Pragmata" }), game + 34 * 60_000));
  const off = game + 50 * 60_000;
  await inRequest(() => recordPlaystationReport(presence(off, false, null), off));
  assert.deepEqual((await closed(storage, "gaming")).map((row) => [row.state, row.title, row.from, row.to]), [
    ["online", null, T0, game],
    ["in-game", "Pragmata", game, off],
  ]);
  assert.equal((await open(storage, "gaming")).state, "offline");
}));

test("iPhone activity keeps raw five-minute buckets, rewrites only from the first change, and stores workout intervals", withStorage(async (storage) => {
  const { recordPhoneEnvelope } = await import("@api/phone-telemetry");
  const start = Date.parse("2026-09-20T08:00:00Z");
  const historyOnly = (buckets: object[], to = start + 3_600_000) => ({ version: 1, modules: { activity: { history: { from: start, to, buckets } } } });
  const buckets = async () => (await storage.listRange(pulseActivityKey(), 0, -1)).map((raw) => JSON.parse(raw));
  await inRequest(() => recordPhoneEnvelope(historyOnly([
    { from: start, to: start + 300_000, steps: 300, moveKcal: 12.5, exerciseMinutes: 1 },
    { from: start + 600_000, to: start + 900_000, moveKcal: 1 },
  ]), start + 3_600_000));
  assert.deepEqual(await buckets(), [
    { from: start, to: start + 300_000, steps: 300, moveKcal: 12.5, exerciseMinutes: 1 },
    { from: start + 600_000, to: start + 900_000, steps: null, moveKcal: 1, exerciseMinutes: null },
  ]);
  assert.equal(await storage.get(pulseActivityRevisionKey()), "1");

  // 同一份重放：不改写、不升版本
  await inRequest(() => recordPhoneEnvelope(historyOnly([
    { from: start, to: start + 300_000, steps: 300, moveKcal: 12.5, exerciseMinutes: 1 },
    { from: start + 600_000, to: start + 900_000, moveKcal: 1 },
  ]), start + 3_600_000));
  assert.equal(await storage.get(pulseActivityRevisionKey()), "1");

  // HealthKit 修订第二个桶、删掉未知：只有范围内的变化
  await inRequest(() => recordPhoneEnvelope(historyOnly([
    { from: start, to: start + 300_000, steps: 300, moveKcal: 12.5, exerciseMinutes: 1 },
    { from: start + 900_000, to: start + 1_200_000, steps: 40 },
  ]), start + 3_600_000));
  assert.deepEqual((await buckets()).map((row) => [row.from - start, row.steps]), [[0, 300], [900_000, 40]]);
  assert.equal(await storage.get(pulseActivityRevisionKey()), "2");

  await inRequest(() => recordPhoneEnvelope({ version: 1, modules: { workouts: { items: [{
    id: "5c1f2d1e-7d7c-4c65-9c1e-2b4b3f3f5a10", activityType: "Fencing", startedAt: start, endedAt: start + 1_800_000,
    secondsFromGMT: 28_800, durationSeconds: 1_800,
  }] } } }, start + 3_600_000));
  assert.deepEqual(JSON.parse((await storage.get(pulseWorkoutsKey()))!), { items: [{ startedAt: start, endedAt: start + 1_800_000, activityType: "Fencing" }] });
}));

test("Recently played changes become uncertain listening traces; the first list and unchanged polls do not", withStorage(async (storage) => {
  const item = (id: string, title: string): ListeningItem => ({ id, title, artist: "YOASOBI", artwork: null, link: null, palette: [], durationMs: null } as unknown as ListeningItem);
  const realNow = Date.now;
  let clock = T0;
  Date.now = () => clock;
  try {
    await inRequest(() => commitRecentlyPlayed([item("a", "THE BOOK")]));
    clock = T0 + 120_000;
    await inRequest(() => commitRecentlyPlayed([item("a", "THE BOOK")]));
    assert.deepEqual(await storage.listRange(pulseListeningTracesKey(), 0, -1), []);
    clock = T0 + 240_000;
    await inRequest(() => commitRecentlyPlayed([item("b", "THE BOOK 3"), item("a", "THE BOOK")]));
    assert.deepEqual((await storage.listRange(pulseListeningTracesKey(), 0, -1)).map((raw) => JSON.parse(raw)), [
      { since: T0 + 120_000, t: T0 + 240_000, title: "THE BOOK 3", artist: "YOASOBI", itemId: "b" },
    ]);
  } finally {
    Date.now = realNow;
  }
}));

test("Cursor history success renews independent observations even without a changed cursorNow", withStorage(async (storage) => {
  const at = Date.now();
  const usage = (t: number) => ({ collectedAt: new Date(t).toISOString(), state: "ok", error: null, warning: null,
    coverageStart: null, coverageEnd: null, precision: "measured", costComplete: true, days: [] });
  await inRequest(async () => {
    await recordAgentLimits({ cursorNow: { lastActivityAt: new Date(at).toISOString(), currentModel: "cursor-model" } }, at);
    await recordAgentLimits({ cursorNow: { lastActivityAt: new Date(at).toISOString(), currentModel: "cursor-model" } }, at + 30_000);
    await recordAgentLimits({ cursorUsage: usage(at + 60_000) }, at + 60_000);
    await recordAgentLimits({ cursorUsage: usage(at + 60_000) }, at + 120_000);
    await recordAgentLimits({ cursorUsage: usage(at - 60_000) }, at + 180_000);
    const rows = (await storage.listRange(cursorObservationsKey(), 0, -1)).map((raw) => JSON.parse(raw));
    assert.deepEqual(rows, [{ t: at, available: true, lastActivityAt: at }, { t: at + 60_000, available: true, lastActivityAt: at }]);
    await recordAgentLimits({ cursorUsage: { ...usage(at + 240_000), warning: "incomplete history" } }, at + 240_000);
    assert.equal(JSON.parse((await storage.listRange(cursorObservationsKey(), -1, -1))[0]).available, false);
  });
}));

test("Mac token windows are stored internally and never enter the public now patch", withStorage(async (storage) => {
  const { prepareVibeCodingNow } = await import("./stores/vibecoding.ts");
  const { codingTokenUsageKey } = await import("@/lib/coding-pulse");
  const from = 1800000000000;
  const tokenUsage = { from, to: from + 300000, collectedAt: from + 420000, sources: [{ id: "codex", state: "ok" }, { id: "claude", state: "unavailable" }],
    windows: [{ from, to: from + 300000, agents: [{ id: "codex", model: "test", inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 5, eventCount: 1 }] }] };
  await inRequest(async () => {
    const prepared = prepareVibeCodingNow({ agents: [], tokenUsage }, from + 420000);
    assert.equal("tokenUsage" in prepared.now, false);
    await prepared.commit();
  });
  assert.deepEqual(JSON.parse((await storage.get(codingTokenUsageKey()))!), tokenUsage);
}));
