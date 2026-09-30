import assert from "node:assert/strict";
import test from "node:test";

import { cueAt, LYRIC_HOLD_GAP_MS, NO_CUE } from "./lyrics-cue.ts";
import type { LyricLine } from "./lyrics-ttml.ts";

const LINES: LyricLine[] = [
  { startMs: 10_000, endMs: 12_000, text: "a" },
  { startMs: 12_300, endMs: 14_000, text: "b" },
  { startMs: 24_000, endMs: 26_000, text: "c" },
];

test("没有歌词就没有结论", () => {
  assert.deepEqual(cueAt([], 5_000), NO_CUE);
});

test("前奏：还没开口，等第一句", () => {
  assert.deepEqual(cueAt(LINES, 0), { index: -1, until: 10_000 });
  assert.deepEqual(cueAt(LINES, 9_999), { index: -1, until: 10_000 });
});

test("唱着的那句一直亮到下一句开口（缝隙小于阈值）", () => {
  assert.deepEqual(cueAt(LINES, 10_000), { index: 0, until: 12_300 });
  assert.deepEqual(cueAt(LINES, 11_999), { index: 0, until: 12_300 });
  assert.deepEqual(cueAt(LINES, 12_100), { index: 0, until: 12_300 });
  assert.deepEqual(cueAt(LINES, 12_300), { index: 1, until: 14_000 });
});

test("间奏比阈值长：这句唱完就退回，等下一句", () => {
  assert.ok(24_000 - 14_000 > LYRIC_HOLD_GAP_MS);
  assert.deepEqual(cueAt(LINES, 13_999), { index: 1, until: 14_000 });
  assert.deepEqual(cueAt(LINES, 14_000), { index: -1, until: 24_000 });
  assert.deepEqual(cueAt(LINES, 20_000), { index: -1, until: 24_000 });
});

test("最后一句过去之后不再变", () => {
  assert.deepEqual(cueAt(LINES, 25_000), { index: 2, until: 26_000 });
  assert.deepEqual(cueAt(LINES, 26_000), { index: -1, until: null });
  assert.deepEqual(cueAt(LINES, 99_000), { index: -1, until: null });
});
