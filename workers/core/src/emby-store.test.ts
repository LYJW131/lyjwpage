import assert from "node:assert/strict";
import test from "node:test";

import { resolveNowPlaying, type EmbyNowPlaying } from "./emby-store";

const TICKS_PER_MS = 10_000;

function state(overrides: Partial<EmbyNowPlaying>): EmbyNowPlaying {
  return {
    itemId: "movie-1",
    paused: false,
    positionTicks: 0,
    runTimeTicks: 0,
    client: null,
    deviceName: null,
    playMethod: null,
    media: null,
    at: Date.now(),
    ...overrides,
  };
}

test("没有播放状态时是 null", () => {
  assert.equal(resolveNowPlaying(null), null);
});

test("暂停的条目按 ticks 换成毫秒并给出已存进度", () => {
  const resolved = resolveNowPlaying(state({
    paused: true,
    positionTicks: 60_000 * TICKS_PER_MS,
    runTimeTicks: 120_000 * TICKS_PER_MS,
    client: "Emby Web",
    deviceName: "Chrome",
    playMethod: "directplay",
  }));
  assert.deepEqual(resolved, {
    itemId: "movie-1",
    paused: true,
    progress: 50,
    client: "Emby Web",
    deviceName: "Chrome",
    playMethod: "directplay",
    media: null,
    positionMs: 60_000,
    durationMs: 120_000,
  });
});

test("缺的播放侧字段一律给 null，不给 0", () => {
  const resolved = resolveNowPlaying(state({ paused: true }));
  assert.deepEqual(resolved, {
    itemId: "movie-1",
    paused: true,
    progress: null,
    client: null,
    deviceName: null,
    playMethod: null,
    media: null,
    positionMs: 0,
    durationMs: null,
  });
});

test("在放的条目从上报时刻往前推进度", () => {
  const resolved = resolveNowPlaying(state({
    positionTicks: 60_000 * TICKS_PER_MS,
    runTimeTicks: 3_600_000 * TICKS_PER_MS,
    at: Date.now() - 30_000,
  }));
  assert.ok(resolved && !resolved.paused);
  assert.ok(Math.abs((resolved.positionMs ?? 0) - 90_000) < 1_500, `positionMs=${resolved.positionMs}`);
  assert.equal(resolved.durationMs, 3_600_000);
});

test("推到片尾（含正好到片尾）按没在看处理", () => {
  assert.equal(resolveNowPlaying(state({
    positionTicks: 3_500_000 * TICKS_PER_MS,
    runTimeTicks: 3_600_000 * TICKS_PER_MS,
    at: Date.now() - 120_000,
  })), null);
  assert.equal(resolveNowPlaying(state({
    positionTicks: 3_600_000 * TICKS_PER_MS,
    runTimeTicks: 3_600_000 * TICKS_PER_MS,
  })), null);
});

test("暂停时进度过满按 100 计，进度条不超界", () => {
  const resolved = resolveNowPlaying(state({
    paused: true,
    positionTicks: 200_000 * TICKS_PER_MS,
    runTimeTicks: 120_000 * TICKS_PER_MS,
  }));
  assert.equal(resolved?.progress, 100);
  assert.equal(resolved?.positionMs, 200_000);
});
