import assert from "node:assert/strict";
import test from "node:test";

import { trackPositionMs, type PlaybackAnchor } from "./track-position.ts";

const ANCHOR: PlaybackAnchor = {
  state: "playing",
  observedAt: 1_000_000,
  positionMs: 30_000,
  durationMs: 200_000,
  repeatOne: false,
};

test("播放中按 observedAt 往前推", () => {
  assert.equal(trackPositionMs(ANCHOR, 1_000_000), 30_000);
  assert.equal(trackPositionMs(ANCHOR, 1_005_000), 35_000);
});

test("暂停后停在锚点上，不跟着墙上的钟走", () => {
  const paused: PlaybackAnchor = { ...ANCHOR, state: "paused" };
  assert.equal(trackPositionMs(paused, 1_000_000), 30_000);
  assert.equal(trackPositionMs(paused, 9_999_999), 30_000);
});

test("设备的钟比浏览器快时不让进度倒着走", () => {
  // now 早于 observedAt：两个时钟本来就不是同一个，差额兜成 0 而不是负数
  assert.equal(trackPositionMs(ANCHOR, 999_000), 30_000);
});

test("首帧 now 传 0 时只画锚点，不用另开分支", () => {
  // 服务端算的偏移和 hydrate 那一刻算的必然差着毫秒，首帧一律不往前推
  assert.equal(trackPositionMs(ANCHOR, 0), 30_000);
});

test("不循环时超出总长就 clamp，等下一条锚点纠正", () => {
  assert.equal(trackPositionMs(ANCHOR, 1_500_000), 200_000);
});

test("单曲循环时绕回开头，而不是钉在 100%", () => {
  const looped: PlaybackAnchor = { ...ANCHOR, repeatOne: true };
  // 30s + 180s = 210s，超出 200s 的总长 10s
  assert.equal(trackPositionMs(looped, 1_180_000), 10_000);
  // 绕两圈也一样
  assert.equal(trackPositionMs(looped, 1_380_000), 10_000);
});

test("拿不到总长时原样返回，不去除以 0", () => {
  const unknown: PlaybackAnchor = { ...ANCHOR, durationMs: 0 };
  assert.equal(trackPositionMs(unknown, 1_005_000), 35_000);
  const loopedUnknown: PlaybackAnchor = { ...unknown, repeatOne: true };
  assert.equal(trackPositionMs(loopedUnknown, 1_005_000), 35_000);
});
