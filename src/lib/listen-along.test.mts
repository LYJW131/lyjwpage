import assert from "node:assert/strict";
import test from "node:test";

import {
  captureLagMs,
  followTargetMs,
  hostRewoundIntoTrack,
  isHostSeek,
  needsResync,
  playbackLagMs,
  queueStartMs,
  shouldSeekAfterTrackChange,
} from "./listen-along.ts";

test("刚开始跟听：从主人此刻起播", () => {
  assert.equal(
    queueStartMs({ changingTrack: false, positionMs: 0, hostPositionMs: 90_000 }),
    90_000,
  );
});

test("跟听中换歌：从锚点起播，不把缓冲耗时算进去", () => {
  assert.equal(
    queueStartMs({ changingTrack: true, positionMs: 0, hostPositionMs: 8_000 }),
    0,
  );
  assert.equal(
    queueStartMs({ changingTrack: true, positionMs: 1_200, hostPositionMs: 8_000 }),
    1_200,
  );
});

test("加载耗时记成滞后，超前不当成负滞后", () => {
  assert.equal(playbackLagMs(12_000, 4_000), 8_000);
  assert.equal(playbackLagMs(4_000, 12_000), 0);
});

test("认滞后时，本地进度还没落到起播点就用起播点", () => {
  // 换歌要从 0 起，seek 刚下完读数还停在 8s
  assert.equal(captureLagMs(12_000, 8_000, 0, 5_000), 12_000);
  // 读数已经贴着起播点，用读数
  assert.equal(captureLagMs(12_000, 500, 0, 5_000), 11_500);
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
  // 跟听停在 22s，主人停在 30s，滞后 8s；续播后两边一起走
  assert.equal(isHostSeek(22_000, 8_000, 30_000, 5_000), false);
});

test("主人拖进度：跟听位置 + 滞后对不上新锚点", () => {
  assert.equal(isHostSeek(22_000, 8_000, 90_000, 5_000), true);
});

test("先切到下一首再等主人锚点：超前记成负滞后，不当成他拖进度", () => {
  assert.equal(isHostSeek(9_000, 2_000 - 9_000, 2_000, 5_000), false);
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
  // 200s 的歌，主人回到 100s：真回去重听，要拉回来
  assert.equal(hostRewoundIntoTrack(100_000, 200_000, 8_000), true);
  // 锚点停在最后 5s：是我们预切后留下的残影，别拉
  assert.equal(hostRewoundIntoTrack(195_000, 200_000, 8_000), false);
  // 总长未知不猜
  assert.equal(hostRewoundIntoTrack(100_000, 0, 8_000), false);
});
