import assert from "node:assert/strict";
import test from "node:test";

import { playbackProgressEases } from "./playback-progress.ts";

const SONG_MS = 180_000;
const SAMPLE_MS = 1_000;

test("第一次没有上一帧，直接落在当前进度", () => {
  assert.equal(playbackProgressEases(null, 40, SONG_MS, SAMPLE_MS), false);
});

test("未知时长或采样间隔不插值", () => {
  assert.equal(playbackProgressEases(10, 11, 0, SAMPLE_MS), false);
  assert.equal(playbackProgressEases(10, 11, SONG_MS, 0), false);
  assert.equal(playbackProgressEases(10, Number.NaN, SONG_MS, SAMPLE_MS), false);
});

test("一秒内的前进沿用过渡", () => {
  const step = (SAMPLE_MS / SONG_MS) * 100;
  assert.equal(playbackProgressEases(20, 20 + step, SONG_MS, SAMPLE_MS), true);
  assert.equal(playbackProgressEases(20, 20, SONG_MS, SAMPLE_MS), true);
});

test("拖动、换曲或循环造成的大步和倒退直接跳到新位置", () => {
  const step = (SAMPLE_MS / SONG_MS) * 100;
  assert.equal(playbackProgressEases(20, 20 + step * 1.75, SONG_MS, SAMPLE_MS), true);
  assert.equal(playbackProgressEases(20, 20 + step * 1.76, SONG_MS, SAMPLE_MS), false);
  assert.equal(playbackProgressEases(92, 3, SONG_MS, SAMPLE_MS), false);
});

test("长片里几十秒的跳进也不插值", () => {
  const movieMs = 3 * 60 * 60 * 1_000;
  const at = 10;
  const seek = at + (30_000 / movieMs) * 100;
  assert.equal(playbackProgressEases(at, seek, movieMs, SAMPLE_MS), false);
});
