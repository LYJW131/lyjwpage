import assert from "node:assert/strict";
import test from "node:test";

import { homePodTrackEnd, homePodVisibleAt, homePodVisibleUntil } from "@/lib/homepod-store";
import type { LocalNowPlaying } from "@/lib/types";

const T = 1_800_000_000_000;
const MINUTE = 60_000;

function music(partial: Partial<LocalNowPlaying> = {}): LocalNowPlaying {
  return {
    source: "homepod",
    state: "playing",
    title: "もうどうなってもいいや",
    artist: "Hoshimachi Suisei",
    album: "もうどうなってもいいや - Single",
    trackId: "t",
    artworkUrl: null,
    positionMs: 2_000,
    durationMs: 203_000,
    repeatOne: false,
    observedAt: T,
    ...partial,
  };
}

test("播放中曲终从 observedAt 起算剩余时长，晚到的上报不从收到时刻再放一遍", () => {
  const lag = 164_000;
  const stored = { music: music({ observedAt: T - lag }), receivedAt: T };
  const end = (T - lag) + (203_000 - 2_000);
  assert.equal(homePodTrackEnd(stored), end);
  assert.equal(homePodVisibleUntil(stored), end + 5 * MINUTE);
  assert.equal(homePodVisibleAt(stored, end), true);
  assert.equal(homePodVisibleAt(stored, end + 5 * MINUTE + 1), false);
  assert.equal(homePodVisibleAt(stored, T + 400_000), false);
});

test("进度锚和收到时刻重合时，曲终仍是剩余时长加在这个时刻上", () => {
  const stored = { music: music({ positionMs: 0, durationMs: 20 * MINUTE, observedAt: T }), receivedAt: T };
  assert.equal(homePodTrackEnd(stored), T + 20 * MINUTE);
  assert.equal(homePodVisibleUntil(stored), T + 25 * MINUTE);
});

test("暂停的 HomePod 进度冻结，剩余从收到时刻算，不随更早的 observedAt 缩短", () => {
  const stored = {
    music: music({ state: "paused", positionMs: 5 * MINUTE, durationMs: 20 * MINUTE, observedAt: T - 10 * MINUTE }),
    receivedAt: T,
  };
  assert.equal(homePodTrackEnd(stored), T + 15 * MINUTE);
  assert.equal(homePodVisibleUntil(stored), T + 20 * MINUTE);
});

test("单曲循环与未知时长不按进度锚收口", () => {
  const loop = { music: music({ repeatOne: true, observedAt: T - 10 * MINUTE }), receivedAt: T };
  assert.equal(homePodTrackEnd(loop), null);
  assert.equal(homePodVisibleUntil(loop), T + 30 * MINUTE);
  const unknown = { music: music({ durationMs: 0, observedAt: T - 10 * MINUTE }), receivedAt: T };
  assert.equal(homePodTrackEnd(unknown), null);
  assert.equal(homePodVisibleUntil(unknown), T + 12 * 60 * MINUTE);
});
