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
import { commitPreparedAgentsReport } from "@api/stores/agents";
import { commitRecentlyPlayed, commitRecentTracks } from "@api/apple-music-recent";
import { installStorageForTests, resetStorageForTests } from "@/lib/storage";
import { FakeStorage } from "@/lib/testing/fake-storage";
import { withRequestState } from "@shared/request-state";
import { LISTENING_TRACE_JITTER_MS } from "@shared/pulse-listening";
import type { StateLane } from "@shared/pulse-timeline";
import { requestStore, type Env } from "@api/runtime";
import { commitPreparedEmbyReport } from "@api/stores/emby";
import { commitPreparedPlaystationReport } from "@api/stores/playstation";
import { getPlayingNow } from "@/lib/playstation";
import { powerMirror } from "@shared/playstation-store";
import { commitPreparedTelemetryEnvelope } from "@api/stores/telemetry";
import type { ListeningItem, RecentTrack } from "@/lib/types";
import { prepareAgentLimits } from "@shared/ingest/agents";
import { prepareEmbyReport } from "@shared/ingest/emby";
import { preparePlaystationReport } from "@shared/ingest/playstation";
import { prepareTelemetryEnvelope } from "@shared/ingest/telemetry";

const recordTelemetryEnvelope = (input: unknown, at: number) => commitPreparedTelemetryEnvelope(prepareTelemetryEnvelope(input, at));
const recordEmbyReport = async (input: unknown, at: number) => commitPreparedEmbyReport(await prepareEmbyReport(input, at, { head: async () => null }));
const recordPlaystationReport = (input: unknown, at: number) => commitPreparedPlaystationReport(preparePlaystationReport(input, at));
const recordAgentsReport = (input: unknown, at: number) => commitPreparedAgentsReport(prepareAgentLimits(input, at));


const T0 = 1_760_000_000_000;

async function inRequest<T>(run: () => Promise<T>): Promise<T> {
  const pending: Promise<unknown>[] = [];
  const context = {
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
  assert.deepEqual(await open(storage, "listening"), { state: "playing", ...helpless, from: T0, seenAt: T0, holdUntil: T0 + 10 * 60_000, endsBy: null });

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
  await inRequest(() => recordTelemetryEnvelope(envelope(T0, ["appleMusic"], { appleMusic: music("playing", T0) }), T0));
  const paused = T0 + 60_000;
  await inRequest(() => recordTelemetryEnvelope(envelope(paused, ["appleMusic"], { appleMusic: music("paused", paused) }), paused));
  const later = T0 + 5 * 60_000;
  await inRequest(() => recordTelemetryEnvelope(envelope(later, ["appleMusic"]), later));
  assert.equal((await open(storage, "listening")).state, "paused", "a paused Music app stays paused");
  const stopped = later + 60_000;
  await inRequest(() => recordTelemetryEnvelope(envelope(stopped, ["appleMusic"], { appleMusic: { ...music("paused", stopped), state: "stopped" } }), stopped));
  assert.deepEqual((await closed(storage, "listening")).map((row) => [row.state, row.from, row.to]), [["playing", T0, paused], ["paused", paused, stopped]]);
  assert.deepEqual(await open(storage, "listening"), { state: "idle", source: null, title: null, artist: null, album: null, trackId: null, from: stopped, seenAt: stopped, holdUntil: stopped + 10 * 60_000, endsBy: null });
}));

test("Mac 下线又没有 HomePod：开着的那段到此为止，之后是未知", withStorage(async (storage) => {
  await inRequest(() => recordTelemetryEnvelope(envelope(T0, ["appleMusic"], { appleMusic: music("playing", T0) }), T0));
  const off = T0 + 90_000;
  await inRequest(() => recordTelemetryEnvelope({ ...envelope(off, ["appleMusic"]), presence: "offline" }, off));
  assert.deepEqual((await closed(storage, "listening")).map((row) => [row.state, row.from, row.to]), [["playing", T0, off]]);
  assert.equal(await open(storage, "listening"), null);
}));

test("HomePod 只在换曲时推：Mac 离线时一首二十分钟的歌照样整段留下，断了也只认到曲终", withStorage(async (storage) => {
  const { commitPreparedHomePodEvent } = await import("@api/homepod-ingest");
  const { prepareHomePodEvent } = await import("@shared/ingest/homepod");
  const push = (at: number, title: string) => inRequest(() => commitPreparedHomePodEvent(prepareHomePodEvent({
    state: "playing", title, artist: "Max Richter", album: "Sleep", positionMs: 0, durationMs: 20 * 60_000, entityId: "media_player.homepod",
  }, at)));
  await push(T0, "Path 5");
  const first = await open(storage, "listening");
  assert.deepEqual([first.holdUntil, first.endsBy], [T0 + 25 * 60_000, T0 + 20 * 60_000], "open until the grace, known until the track end");
  await push(T0 + 20 * 60_000, "Path 6");
  await push(T0 + 80 * 60_000, "Path 7");
  assert.deepEqual((await closed(storage, "listening")).map((row) => [row.source, row.title, row.from, row.to]), [
    ["homepod", "Path 5", T0, T0 + 20 * 60_000],
    ["homepod", "Path 6", T0 + 20 * 60_000, T0 + 40 * 60_000],
  ]);
}));

test("Mac 死了：在听的那一段只认到最后一次心跳", withStorage(async (storage) => {
  await inRequest(() => recordTelemetryEnvelope(envelope(T0, ["appleMusic"], { appleMusic: music("playing", T0) }), T0));
  await inRequest(() => recordTelemetryEnvelope(envelope(T0 + 60_000, ["appleMusic"]), T0 + 60_000));
  await inRequest(() => recordTelemetryEnvelope(envelope(T0 + 90_000, ["appleMusic"]), T0 + 90_000));
  const back = T0 + 30 * 60_000;
  await inRequest(() => recordTelemetryEnvelope(envelope(back, ["appleMusic"]), back));
  assert.deepEqual((await closed(storage, "listening")).map((row) => [row.state, row.from, row.to]), [["playing", T0, T0 + 60_000]],
    "the last written confirmation, not ten more minutes of assumed listening");
  assert.equal((await open(storage, "listening")).from, back);
}));

test("desktop 模块关掉后，留着的前台应用不再被记成 coding", withStorage(async (storage) => {
  await inRequest(() => recordTelemetryEnvelope(envelope(T0, ["desktop"], {
    desktop: { applicationName: "Cursor", bundleIdentifier: "com.todesktop.230313mzl4w4u92" },
  }), T0));
  const off = T0 + 60_000;
  await inRequest(() => recordTelemetryEnvelope(envelope(off, ["coding"], {
    codingActivity: { collectedAt: off, agents: [{ id: "claude", lastActivityAt: null, model: null }] },
  }), off));
  const rows = (await storage.listRange(codingObservationsKey(), 0, -1)).map((raw) => JSON.parse(raw));
  assert.deepEqual(rows.map((row) => row.desktop), [{ application: "Cursor", coding: true }, null]);
  assert.equal(await storage.get(pulseLaneOpenKey("listening")), null, "no appleMusic module means listening is not observed");
}));

function activity(at: number, lastActivityAt: number | null, id = "claude", model: string | null = "claude-opus-5") {
  return { codingActivity: { collectedAt: at, agents: [{ id, lastActivityAt, model }] } };
}

test("agent 在不在跑按活动时刻现算：最近事件 5 分钟内算在跑，之后不算；保活续命，采集时刻 10 分钟不动才当未知", withStorage(async (storage) => {
  await inRequest(() => recordTelemetryEnvelope(envelope(T0, ["coding"], activity(T0, T0 - 30_000)), T0));
  const quiet = T0 + 6 * 60_000;
  await inRequest(() => recordTelemetryEnvelope(envelope(quiet, ["coding"]), quiet));
  const kept = T0 + 9 * 60_000;
  await inRequest(() => recordTelemetryEnvelope(envelope(kept, ["coding"], activity(kept, T0 - 30_000)), kept));
  const stillKnown = T0 + 18 * 60_000;
  await inRequest(() => recordTelemetryEnvelope(envelope(stillKnown, ["coding"]), stillKnown));
  const stale = T0 + 20 * 60_000;
  await inRequest(() => recordTelemetryEnvelope(envelope(stale, ["coding"]), stale));
  const off = T0 + 21 * 60_000;
  await inRequest(() => recordTelemetryEnvelope(envelope(off, ["coding"], activity(off, off - 1_000)), off));
  await inRequest(() => recordTelemetryEnvelope(envelope(off + 30_000, []), off + 30_000));
  const rows = (await storage.listRange(codingObservationsKey(), 0, -1)).map((raw) => JSON.parse(raw));
  assert.deepEqual(rows.map((row) => row.agents?.[0]?.active ?? null), [true, false, false, false, null, true, null]);
  assert.deepEqual(rows[0].agents, [{ id: "claude", model: "claude-opus-5", active: true }]);
  assert.equal(rows[4].available, false);
}));

test("Coding observations keep foreground changes and idle heartbeats, and stop on explicit offline", withStorage(async (storage) => {
  await inRequest(() => recordTelemetryEnvelope(envelope(T0, ["desktop", "coding"], {
    desktop: { applicationName: "Cursor", bundleIdentifier: "com.todesktop.230313mzl4w4u92" },
    ...activity(T0, T0 - 5_000, "codex", "<synthetic>"),
  }), T0));
  await inRequest(() => recordTelemetryEnvelope(envelope(T0 + 20_000, ["desktop", "coding"], {
    desktop: { applicationName: "Zed", bundleIdentifier: "dev.zed.Zed" },
  }), T0 + 20_000));
  await inRequest(() => recordTelemetryEnvelope(envelope(T0 + 110_000, ["desktop", "coding"]), T0 + 110_000));
  await inRequest(() => recordTelemetryEnvelope({ ...envelope(T0 + 120_000, ["desktop", "coding"]), presence: "offline" }, T0 + 120_000));
  const rows = (await storage.listRange(codingObservationsKey(), 0, -1)).map((raw) => JSON.parse(raw));
  assert.equal(rows.length, 4);
  assert.equal(rows[0].desktop.application, "Cursor");
  assert.deepEqual(rows[0].agents, [{ id: "codex", model: null, active: true }], "placeholder model names never become a model");
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
  await inRequest(() => recordTelemetryEnvelope(charger(T0 + 20_000, 46), T0 + 20_000));
  assert.equal((await samples()).length, 1);
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
  assert.deepEqual(await open(storage, "watching"), { state: "playing", itemId: "77", title: null, subtitle: null, from: other, seenAt: other, holdUntil: other + 10 * 60_000, endsBy: null });

  const stop = other + 60_000;
  await inRequest(() => recordEmbyReport({ playing: null }, stop));
  assert.equal((await open(storage, "watching")).state, "idle");
  const resume = stop + 5 * 3_600_000;
  await inRequest(() => recordEmbyReport({ playing: { itemId: "42", paused: false, positionTicks: 2, runTimeTicks: 36_000_000_000 } }, resume));
  assert.deepEqual((await closed(storage, "watching")).at(-1), { state: "idle", itemId: null, title: null, subtitle: null, from: stop, to: resume });
}));

test("PSN 在线状态：进游戏、换游戏、下线各是一段", withStorage(async (storage) => {
  const presence = (at: number, online: boolean, playing: { titleId: string; title: string } | null) =>
    ({ version: 1, presence: { observedAt: at, online, availability: null, platform: "PS5", lastOnlineAt: null,
      playing: playing && { ...playing, format: null, launchPlatform: null, iconUrl: null } } });
  await inRequest(() => recordPlaystationReport(presence(T0, true, null), T0));
  await powerMirror.put({ on: true, observedAt: T0, entityId: "switch.ps5_210_power" });
  assert.equal("power" in await getPlayingNow(), false, "保留的内部镜像不进入公开 presence");
  const game = T0 + 20 * 60_000;
  await inRequest(() => recordPlaystationReport(presence(game, true, { titleId: "PPSA01", title: "Pragmata" }), game));
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
  const { commitPreparedPhoneEnvelope } = await import("@api/phone-telemetry");
  const { preparePhoneEnvelope } = await import("@shared/ingest/phone");
  const recordPhoneEnvelope = (input: unknown, at: number) => commitPreparedPhoneEnvelope(preparePhoneEnvelope(input, at));
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

  await inRequest(() => recordPhoneEnvelope(historyOnly([
    { from: start, to: start + 300_000, steps: 300, moveKcal: 12.5, exerciseMinutes: 1 },
    { from: start + 600_000, to: start + 900_000, moveKcal: 1 },
  ]), start + 3_600_000));
  assert.equal(await storage.get(pulseActivityRevisionKey()), "1");

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

test("Recently played song changes become listening traces with lengths; the first list, unchanged polls, stale copies and the album list do not", withStorage(async (storage) => {
  const track = (id: string, title: string): RecentTrack => ({ id, title, artist: "YOASOBI", album: "THE BOOK 3" });
  const album = (id: string, title: string) => ({ id, title, artist: "YOASOBI", artwork: null, link: null, palette: [], durationMs: null } as ListeningItem);
  const realNow = Date.now;
  let clock = T0;
  Date.now = () => clock;
  try {
    assert.deepEqual(await inRequest(() => commitRecentTracks([track("a", "Idol")])), { traced: false });
    clock = T0 + 120_000;
    await inRequest(() => commitRecentTracks([track("a", "Idol")]));
    await inRequest(() => commitRecentlyPlayed([album("x", "THE BOOK 3")]));
    clock = T0 + 180_000;
    await inRequest(() => commitRecentlyPlayed([album("y", "THE BOOK 2"), album("x", "THE BOOK 3")]));
    assert.deepEqual(await storage.listRange(pulseListeningTracesKey(), 0, -1), []);
    clock = T0 + 240_000;
    const nextBy = T0 + 180_000 + 261_000 + 60_000 + LISTENING_TRACE_JITTER_MS;
    assert.deepEqual(await inRequest(() => commitRecentTracks([{ ...track("b", "Yoru ni Kakeru"), durationMs: 261_000 }, track("a", "Idol")])), { traced: true, nextBy },
      "the next song should top the list by b's start (the window midpoint, before the lag), its length, the lag, half the window and the jitter");
    clock = T0 + 300_000;
    assert.deepEqual(await inRequest(() => commitRecentTracks([track("a", "Idol")])), { traced: false, nextBy }, "an edge copy from before b");
    clock = T0 + 360_000;
    assert.deepEqual(await inRequest(() => commitRecentTracks([track("c", "Idol 2"), track("b", "Yoru ni Kakeru"), track("a", "Idol")], T0 + 350_000)), { traced: true });
    clock = T0 + 420_000;
    await inRequest(() => commitRecentTracks([track("d", "Idol 3"), track("c", "Idol 2"), track("b", "Yoru ni Kakeru")], T0 - 3_600_000));
    assert.deepEqual((await storage.listRange(pulseListeningTracesKey(), 0, -1)).map((raw) => JSON.parse(raw)), [
      { since: T0 + 120_000, t: T0 + 240_000, title: "Yoru ni Kakeru", artist: "YOASOBI", album: "THE BOOK 3", itemId: "b", durationMs: 261_000, songId: null, artworkUrl: null },
      { since: T0 + 240_000, t: T0 + 350_000, title: "Idol 2", artist: "YOASOBI", album: "THE BOOK 3", itemId: "c", durationMs: null, songId: null, artworkUrl: null },
      { since: T0 + 350_000, t: T0 + 420_000, title: "Idol 3", artist: "YOASOBI", album: "THE BOOK 3", itemId: "d", durationMs: null, songId: null, artworkUrl: null },
    ], "the stale copy neither traced nor moved the baseline, so b is not counted again; windows use when the list was fetched unless that time is implausible");
  } finally {
    Date.now = realNow;
  }
}));

test("Cursor history success renews independent account observations even without newer activity", withStorage(async (storage) => {
  const at = Date.now();
  const usage = (t: number, extra: Record<string, unknown> = {}) => ({
    agents: [{ id: "cursor", state: "ok", collectedAt: t, error: null, warning: null, sessionCount: null, days: [], ...extra }],
  });
  const now = (t: number, lastActivityAt: number) => ({ collectedAt: t, agents: [{ id: "cursor", lastActivityAt, model: "cursor-model" }] });
  await inRequest(async () => {
    await recordAgentsReport({ codingActivity: now(at, at) }, at);
    await recordAgentsReport({ codingActivity: now(at + 30_000, at) }, at + 30_000);
    await recordAgentsReport({ codingUsage: usage(at + 60_000) }, at + 60_000);
    await recordAgentsReport({ codingUsage: usage(at + 60_000) }, at + 120_000);
    await recordAgentsReport({ codingUsage: usage(at - 60_000) }, at + 180_000);
    const rows = (await storage.listRange(cursorObservationsKey(), 0, -1)).map((raw) => JSON.parse(raw));
    assert.deepEqual(rows, [{ t: at, available: true, lastActivityAt: at }, { t: at + 60_000, available: true, lastActivityAt: at }]);
    await recordAgentsReport({ codingUsage: usage(at + 240_000, { warning: "incomplete history" }) }, at + 240_000);
    assert.equal(JSON.parse((await storage.listRange(cursorObservationsKey(), -1, -1))[0]).available, false);
  });
}));

test("Mac token buckets are stored internally and never enter the coding-now push", withStorage(async (storage) => {
  const { codingBucketsKey } = await import("@shared/coding-store");
  const { parseStoredCodingBuckets } = await import("@shared/coding-buckets");
  const from = 1_800_000_000_000;
  const at = from + 420_000;
  const codingTokenBuckets = { from, to: from + 300_000, collectedAt: at, agents: [{ id: "codex", state: "ok" }, { id: "claude", state: "unavailable" }],
    windows: [{ from, agents: [{ id: "codex", model: "test", inputTokens: 10, outputTokens: 20, cacheReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 5, eventCount: 1 }] }] };
  const pushed: string[] = [];
  await inRequest(async () => {
    const { collectIngestEffects } = await import("@api/ingest-effects");
    const result = await collectIngestEffects(() => recordTelemetryEnvelope(envelope(at, ["coding"], {
      codingTokenBuckets, codingActivity: { collectedAt: at, agents: [{ id: "codex", lastActivityAt: at - 1_000, model: "test" }] },
    }), at));
    for (const effect of result.effects) if (effect.kind === "event") pushed.push(JSON.stringify(effect.event));
  });
  const stored = parseStoredCodingBuckets(await storage.get(codingBucketsKey("mac")));
  assert.deepEqual(stored?.coverage, [{ from, to: from + 300_000 }]);
  assert.equal(stored?.windows[0]?.agents[0]?.outputTokens, 20);
  assert.equal(pushed.length, 1);
  assert.equal(pushed.some((event) => event.includes("outputTokens")), false);
}));

test("没有播放可接的暂停（Mac 上线时 Music 已经停着）记成空闲", withStorage(async (storage) => {
  await inRequest(() => recordTelemetryEnvelope(envelope(T0, ["appleMusic"], { appleMusic: music("paused", T0) }), T0));
  assert.equal((await open(storage, "listening")).state, "idle");
}));
