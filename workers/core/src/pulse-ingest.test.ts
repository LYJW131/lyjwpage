import assert from "node:assert/strict";
import test from "node:test";

import {
  pulseListeningTracesKey,
} from "./pulse-keys";
import { commitRecentlyPlayed, commitRecentTracks } from "@core/apple-music-recent";
import { LISTENING_TRACE_JITTER_MS } from "@shared/pulse-listening";
import { commitPreparedTelemetryEnvelope } from "@core/stores/telemetry";
import type { ListeningItem, RecentTrack } from "@shared/types";
import { prepareTelemetryEnvelope } from "@shared/ingest/telemetry";
import { T0, closed, envelope, inRequest, open, withStorage } from "./testing/pulse-ingest-harness";

const recordTelemetryEnvelope = (input: unknown, at: number) => commitPreparedTelemetryEnvelope(prepareTelemetryEnvelope(input, at));

function music(state: "playing" | "paused", observedAt: number, title = "Helpless") {
  return { state, title, artist: "Hamilton", album: "Hamilton (Original Broadway Cast Recording)", positionMs: 0, durationMs: 180_000, observedAt };
}

const helpless = { source: "mac", title: "Helpless", artist: "Hamilton", album: "Hamilton (Original Broadway Cast Recording)", trackId: null };

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
  const { commitPreparedHomePodEvent } = await import("@core/homepod-ingest");
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

test("没有播放可接的暂停（Mac 上线时 Music 已经停着）记成空闲", withStorage(async (storage) => {
  await inRequest(() => recordTelemetryEnvelope(envelope(T0, ["appleMusic"], { appleMusic: music("paused", T0) }), T0));
  assert.equal((await open(storage, "listening")).state, "idle");
}));
