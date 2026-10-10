import assert from "node:assert/strict";
import test from "node:test";

import { RESUME_FIELDS, resumeProgress } from "./progress.ts";

const TICKS_PER_MS = 10_000;

test("PlayedPercentage 为 0 时用 ticks 和片长，不把续播点抹成 0", () => {
  const progress = resumeProgress({
    RunTimeTicks: 24 * 60_000 * TICKS_PER_MS,
    UserData: { PlayedPercentage: 0, PlaybackPositionTicks: 8 * 60_000 * TICKS_PER_MS },
  });
  assert.ok(Math.abs(progress - (8 / 24) * 100) < 1e-9);
});

test("ticks 缺失时才信 PlayedPercentage，并夹在 0 到 100", () => {
  assert.equal(resumeProgress({ UserData: { PlayedPercentage: 70.368 } }), 70.368);
  assert.equal(resumeProgress({ RunTimeTicks: 0, UserData: { PlayedPercentage: 31 } }), 31);
  assert.equal(resumeProgress({ UserData: { PlayedPercentage: 140 } }), 100);
  assert.equal(resumeProgress({ UserData: { PlayedPercentage: -4 } }), 0);
});

test("两边都没有、或 ticks 有但没有片长，进度是 0", () => {
  assert.equal(resumeProgress({}), 0);
  assert.equal(resumeProgress({ UserData: { PlaybackPositionTicks: 50_000 } }), 0);
  assert.equal(
    resumeProgress({ RunTimeTicks: 1_000, UserData: { PlayedPercentage: 0, PlaybackPositionTicks: 0 } }),
    0,
  );
});

test("续播列表要显式要片长和上次播放时间", () => {
  assert.ok(RESUME_FIELDS.includes("RunTimeTicks"));
  assert.ok(RESUME_FIELDS.includes("UserDataLastPlayedDate"));
  assert.ok(RESUME_FIELDS.includes("UserDataPlayCount"));
});
