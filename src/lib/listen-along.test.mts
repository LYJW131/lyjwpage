import assert from "node:assert/strict";
import test from "node:test";

import {
  followTargetMs,
  hostRewoundIntoTrack,
  isHostSeek,
  needsResync,
  playbackLagMs,
  shouldSeekAfterTrackChange,
} from "./listen-along.ts";

test("加载耗时记成滞后，超前不当成负滞后", () => {
  assert.equal(playbackLagMs(12_000, 4_000), 8_000);
  assert.equal(playbackLagMs(4_000, 12_000), 0);
});

test("巡检目标扣掉已认的滞后，不再把加载耗时 seek 掉", () => {
  assert.equal(followTargetMs(32_000, 8_000), 24_000);
  assert.equal(followTargetMs(3_000, 8_000), 0);
});

test("偏差超过阈值才重对齐", () => {
  assert.equal(needsResync(24_000, 24_500, 5_000), false);
  assert.equal(needsResync(24_000, 32_000, 5_000), true);
});

test("续播对得上滞后，不当成主人拖进度", () => {
  assert.equal(isHostSeek(22_000, 8_000, 30_000, 5_000), false);
});

test("主人拖进度：跟听位置 + 滞后对不上新锚点", () => {
  assert.equal(isHostSeek(22_000, 8_000, 90_000, 5_000), true);
});

test("先切到下一首再等主人锚点：超前记成负滞后，不当成他拖进度", () => {
  assert.equal(isHostSeek(9_000, 2_000 - 9_000, 2_000, 5_000), false);
});

test("单曲循环绕回开头：按环上距离算，不当成拖进度", () => {
  assert.equal(isHostSeek(228_000, 0, 2_000, 5_000, 230_000), false);
  assert.equal(needsResync(228_000, 2_000, 5_000, 230_000), false);
  assert.equal(isHostSeek(228_000, 0, 2_000, 5_000), true);
  assert.equal(isHostSeek(228_000, 0, 100_000, 5_000, 230_000), true);
});

test("正常下一首锚点在开头，不对齐", () => {
  assert.equal(shouldSeekAfterTrackChange(0, 5_000), false);
  assert.equal(shouldSeekAfterTrackChange(1_200, 5_000), false);
});

test("换歌时已经在歌中间，对齐", () => {
  assert.equal(shouldSeekAfterTrackChange(8_000, 5_000), true);
  assert.equal(shouldSeekAfterTrackChange(90_000, 5_000), true);
});

test("锚点钉在歌尾是切歌残影，拖回歌中间才算重听", () => {
  assert.equal(hostRewoundIntoTrack(100_000, 200_000, 8_000), true);
  assert.equal(hostRewoundIntoTrack(195_000, 200_000, 8_000), false);
  assert.equal(hostRewoundIntoTrack(100_000, 0, 8_000), false);
});
