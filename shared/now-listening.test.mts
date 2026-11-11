import assert from "node:assert/strict";
import test from "node:test";

import { heartbeatWindowMs } from "@shared/freshness";
import { LISTENING_ELSEWHERE_HOLD_MS } from "@shared/limits";
import { pickNowListening, type NowListeningCandidate } from "@shared/now-listening";
import type { Liveness } from "@shared/reporter-liveness";
import type { LocalNowPlaying } from "@shared/types";
import { LISTENING_TRACE_LAG_MS, type ListeningTrace } from "@shared/pulse-listening";

const NOW = 1_700_000_000_000;
const online: Liveness = { lastSeenAt: NOW - 1_000, declaredOffline: false };

function candidate(
  source: LocalNowPlaying["source"],
  state: LocalNowPlaying["state"],
  title: string,
): NowListeningCandidate {
  return {
    music: {
      source,
      state,
      title,
      artist: null,
      album: null,
      trackId: null,
      artworkUrl: null,
      positionMs: 0,
      durationMs: 180_000,
      repeatOne: false,
      observedAt: NOW,
    },
    receivedAt: NOW,
    id: `${title}-album`,
    link: null,
    songId: `${title}-song`,
    upcomingSongIds: [],
    hasLyrics: false,
    motion: null,
  };
}

test("payload 带着 Mac 的存活原样事实，不带「此刻在不在线」的结论", () => {
  const payload = pickNowListening(
    { mac: candidate("apple-music", "playing", "mac"), homePod: null, macReceivedAt: NOW },
    { lastSeenAt: NOW - 1_000, declaredOffline: false },
    NOW,
  );
  assert.equal(payload.lastSeenAt, NOW - 1_000);
  assert.equal(payload.declaredOffline, false);
  assert.equal(payload.heartbeatWindowMs, heartbeatWindowMs());
  assert.equal("offlineAtSource" in payload, false);
});

test("选中 Mac 而 HomePod 也在放：HomePod 那首作为 alternate 一起给", () => {
  const payload = pickNowListening(
    {
      mac: candidate("apple-music", "playing", "mac"),
      homePod: candidate("homepod", "playing", "pod"),
      macReceivedAt: NOW,
    },
    online,
    NOW,
  );
  assert.equal(payload.music?.title, "mac");
  assert.equal(payload.alternate?.music.title, "pod");
  assert.equal(payload.alternate?.songId, "pod-song");
});

test("HomePod 暂停着不当 alternate：宽限期要用源站的钟算，浏览器接不了", () => {
  const payload = pickNowListening(
    {
      mac: candidate("apple-music", "playing", "mac"),
      homePod: candidate("homepod", "paused", "pod"),
      macReceivedAt: NOW,
    },
    online,
    NOW,
  );
  assert.equal(payload.music?.title, "mac");
  assert.equal(payload.alternate, null);
});

test("选中的已经是 HomePod：没有 alternate", () => {
  const payload = pickNowListening(
    { mac: null, homePod: candidate("homepod", "playing", "pod"), macReceivedAt: 0 },
    online,
    NOW,
  );
  assert.equal(payload.music?.title, "pod");
  assert.equal(payload.alternate, null);
});

test("源站取数那一刻 Mac 已掉线：直接选 HomePod（选择仍在源站做）", () => {
  const payload = pickNowListening(
    {
      mac: candidate("apple-music", "playing", "mac"),
      homePod: candidate("homepod", "playing", "pod"),
      macReceivedAt: NOW,
    },
    { lastSeenAt: NOW - heartbeatWindowMs() - 1, declaredOffline: false },
    NOW,
  );
  assert.equal(payload.music?.title, "pod");
  assert.equal(payload.alternate, null);
});

test("没有 Mac / HomePod 在放同一首时，带上推断出的别处播放；放完再等一会儿、或被实测解释后就没有", () => {
  const trace = (since: number, t: number, title: string): ListeningTrace => ({
    since, t, title, artist: "YOASOBI", album: "THE BOOK", itemId: title, durationMs: 200_000, songId: `${title}-song`, artworkUrl: null,
  });
  const traces = [trace(NOW - 70_000, NOW - 10_000, "Idol")];
  const snapshot = (mac: NowListeningCandidate | null) => ({ mac, homePod: null, macReceivedAt: NOW, traces });
  const elsewhere = pickNowListening(snapshot(null), online, NOW).elsewhere;
  assert.equal(elsewhere?.title, "Idol");
  assert.equal(elsewhere?.songId, "Idol-song");
  assert.equal(elsewhere?.startedAt, NOW - 40_000 - LISTENING_TRACE_LAG_MS);
  assert.equal(elsewhere?.durationMs, 200_000);
  const endsAt = NOW - 40_000 - LISTENING_TRACE_LAG_MS + 200_000;
  assert.equal(pickNowListening(snapshot(null), online, endsAt + LISTENING_ELSEWHERE_HOLD_MS - 1).elsewhere?.title, "Idol", "held a little past its end, waiting for the next song to show up");
  assert.equal(pickNowListening(snapshot(null), online, endsAt + LISTENING_ELSEWHERE_HOLD_MS).elsewhere, null, "the song has run out");
  assert.equal(pickNowListening(snapshot(candidate("apple-music", "playing", "Idol")), online, NOW).elsewhere, null, "the Mac is playing it");
  assert.equal(pickNowListening(snapshot(candidate("apple-music", "paused", "Idol")), online, NOW).elsewhere?.title, "Idol", "a paused Mac explains nothing");
  const namesake = candidate("apple-music", "playing", "idol");
  assert.equal(pickNowListening(snapshot({ ...namesake, music: { ...namesake.music, artist: "yoasobi" } }), online, NOW).elsewhere, null, "case aside, same title and artist");
  assert.equal(pickNowListening(snapshot({ ...namesake, music: { ...namesake.music, artist: "Pinocchio-P" } }), online, NOW).elsewhere?.title, "Idol", "another artist's song of the same name");
});

test("播放器那一格：Mac 没在放时选它，HomePod 也在放就作为 alternate；Mac 在放时它当 alternate", () => {
  const fromPlayer = pickNowListening(
    { mac: candidate("apple-music", "stopped", "mac"), homePod: candidate("homepod", "playing", "pod"), player: candidate("omarchy", "playing", "ringo"), macReceivedAt: NOW },
    online,
    NOW,
  );
  assert.equal(fromPlayer.music?.title, "ringo");
  assert.equal(fromPlayer.music?.source, "omarchy");
  assert.equal(fromPlayer.alternate?.music.title, "pod");

  const fromMac = pickNowListening(
    { mac: candidate("apple-music", "playing", "mac"), homePod: null, player: candidate("mac", "playing", "ringo"), macReceivedAt: NOW },
    online,
    NOW,
  );
  assert.equal(fromMac.music?.title, "mac");
  assert.equal(fromMac.alternate?.music.title, "ringo");
});

test("别处播放：在放的那格补全出的目录 id 与推断的同一首对上，即使艺人写法不同也不另报别处", () => {
  const playing = { ...candidate("mac", "playing", "Idol"), songId: "1" };
  playing.music = { ...playing.music, artist: "YOASOBI, Ayase" };
  const snapshot = { mac: null, homePod: null, player: playing, macReceivedAt: NOW };
  const trace: ListeningTrace = { since: NOW - 60_000, t: NOW - 50_000, title: "Idol", artist: "YOASOBI & Ayase", album: null, itemId: "1", durationMs: 200_000, songId: "1", artworkUrl: null };
  const withTrace = pickNowListening({ ...snapshot, traces: [trace] }, online, NOW);
  const bare = pickNowListening({ ...snapshot, player: { ...playing, songId: null }, traces: [trace] }, online, NOW);
  assert.equal(withTrace.elsewhere, null);
  assert.equal(bare.elsewhere?.title, "Idol", "without a catalog id the differently written artist does not match");
});
