import assert from "node:assert/strict";
import test from "node:test";
import {
  AGENT_LIMITS_STALE_MS,
  chargingFeedClockStale,
  isStale,
  liveChargingFeed,
  liveNowListening,
  PLAYSTATION_STALE_MS,
  type ChargingFeed,
} from "./freshness.ts";
import type { LocalNowPlaying, NowListeningPayload } from "./types.ts";

test("PlayStation 陈旧窗口覆盖三轮闲档（30 分钟），并在缓存余量耗尽后变陈旧", () => {
  const windowMs = PLAYSTATION_STALE_MS;
  assert.equal(windowMs, 95 * 60_000);
  const at = 1_000;
  assert.equal(isStale({ now: at + 3 * 30 * 60_000, at, windowMs }), false);
  assert.equal(isStale({ now: at + windowMs, at, windowMs }), false);
  assert.equal(isStale({ now: at + windowMs + 1, at, windowMs }), true);
});

test("限额陈旧窗口覆盖三轮闲档（60 分钟）", () => {
  const windowMs = AGENT_LIMITS_STALE_MS;
  assert.equal(windowMs, 185 * 60_000);
  const at = 1_000;
  assert.equal(isStale({ now: at + 3 * 60 * 60_000, at, windowMs }), false);
  assert.equal(isStale({ now: at + windowMs, at, windowMs }), false);
  assert.equal(isStale({ now: at + windowMs + 1, at, windowMs }), true);
});

const T = 1_700_000_000_000;

function feed(partial: Partial<ChargingFeed> = {}): ChargingFeed {
  return {
    connected: true,
    pushedAt: T,
    staleAfterMs: 300_000,
    lastSeenAt: T,
    declaredOffline: false,
    heartbeatWindowMs: 300_000,
    ...partial,
  };
}

test("充电头 / 充电宝按钟判：Mac 心跳窗口或这一路自己的窗口，过了任一个就算断", () => {
  assert.equal(chargingFeedClockStale(feed(), T + 300_000), false);
  assert.equal(chargingFeedClockStale(feed({ lastSeenAt: T - 1 }), T + 300_000), true);
  assert.equal(chargingFeedClockStale(feed({ pushedAt: T - 1 }), T + 300_000), true);
  // 从没收到过：挂载后（有钟）就算断
  assert.equal(chargingFeedClockStale(feed({ pushedAt: 0 }), T), true);
  // 亲口离线不归这里管
  assert.equal(chargingFeedClockStale(feed({ declaredOffline: true }), T), false);
});

test("首帧没有访客钟：按钟一律不判，免得和服务端 HTML 各画各的", () => {
  assert.equal(chargingFeedClockStale(feed({ lastSeenAt: 1, pushedAt: 1 }), 0), false);
});

test("liveChargingFeed 把亲口离线和按钟断流盖成 connected: false，其余原样", () => {
  const live = feed();
  assert.equal(liveChargingFeed(live, false), live);
  assert.equal(liveChargingFeed(live, true).connected, false);
  assert.equal(liveChargingFeed(feed({ declaredOffline: true }), false).connected, false);
  // 本来就没连着的不会被翻成连着
  assert.equal(liveChargingFeed(feed({ connected: false }), false).connected, false);
  // 只改 connected，读数原样留着
  const patched = liveChargingFeed({ ...live, totalPower: 42 }, true);
  assert.equal(patched.totalPower, 42);
});

function song(source: LocalNowPlaying["source"], title: string): LocalNowPlaying {
  return {
    source,
    state: "playing",
    title,
    artist: null,
    album: null,
    trackId: null,
    artworkUrl: null,
    positionMs: 0,
    durationMs: 180_000,
    repeatOne: false,
    observedAt: T,
  };
}

function nowListening(partial: Partial<NowListeningPayload> = {}): NowListeningPayload {
  return {
    music: song("apple-music", "Mac"),
    receivedAt: T,
    idle: false,
    id: "mac-album",
    link: "https://music.apple.com/mac",
    songId: "mac-song",
    upcomingSongIds: ["mac-next"],
    hasLyrics: true,
    expiresInMs: null,
    alternate: null,
    lastSeenAt: T,
    declaredOffline: false,
    heartbeatWindowMs: 300_000,
    ...partial,
  };
}

test("正在听：Mac 在线时原样", () => {
  const payload = nowListening();
  assert.equal(liveNowListening(payload, false), payload);
});

test("正在听：Mac 掉线且没有接班的，就当没在放", () => {
  const next = liveNowListening(nowListening({ expiresInMs: 4_000 }), true);
  assert.equal(next.idle, true);
  assert.equal(next.music, null);
  assert.equal(next.songId, null);
  assert.deepEqual(next.upcomingSongIds, []);
  assert.equal(next.hasLyrics, false);
  assert.equal(next.expiresInMs, null);
});

test("正在听：Mac 掉线时换成 HomePod 还在放的那首", () => {
  const pod = song("homepod", "HomePod");
  const next = liveNowListening(
    nowListening({
      alternate: {
        music: pod,
        id: "pod-album",
        link: "https://music.apple.com/pod",
        songId: "pod-song",
        upcomingSongIds: [],
        hasLyrics: false,
      },
    }),
    true,
  );
  assert.equal(next.idle, false);
  assert.equal(next.music, pod);
  assert.equal(next.id, "pod-album");
  assert.equal(next.songId, "pod-song");
  assert.equal(next.hasLyrics, false);
  assert.equal(next.alternate, null);
});

test("正在听：选中的是 HomePod 时不看 Mac 的存活", () => {
  const payload = nowListening({ music: song("homepod", "HomePod") });
  assert.equal(liveNowListening(payload, true), payload);
});
