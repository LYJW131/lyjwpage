import assert from "node:assert/strict";
import test from "node:test";

import { heartbeatWindowMs } from "@/lib/freshness";
import { pickNowListening, type NowListeningCandidate } from "@/lib/now-listening";
import type { Liveness } from "@/lib/reporter-liveness";
import type { LocalNowPlaying } from "@/lib/types";

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
