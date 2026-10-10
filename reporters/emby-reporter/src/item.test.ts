import assert from "node:assert/strict";
import test from "node:test";

import { RESUME_FIELDS, normalizePlayedAt, resolveProgress } from "./item.ts";

const TICKS = 10_000_000;

test("续播字段点名 LastPlayedDate，否则 Emby 不返回观看时间", () => {
  assert.match(RESUME_FIELDS, /UserDataLastPlayedDate/);
  assert.match(RESUME_FIELDS, /UserDataPlayCount/);
});

test("百分比是 0 但刻度有位置时用刻度", () => {
  assert.equal(
    resolveProgress({
      RunTimeTicks: 100 * TICKS,
      UserData: { PlayedPercentage: 0, PlaybackPositionTicks: 31 * TICKS },
    }),
    31,
  );
});

test("刻度为 0 时保留百分比，避免把已有进度清掉", () => {
  assert.equal(
    resolveProgress({
      RunTimeTicks: 100 * TICKS,
      UserData: { PlayedPercentage: 70.5, PlaybackPositionTicks: 0 },
    }),
    70.5,
  );
});

test("刻度和时长都在就用刻度，百分比只是退路", () => {
  assert.equal(
    resolveProgress({
      RunTimeTicks: 200 * TICKS,
      UserData: { PlayedPercentage: 10, PlaybackPositionTicks: 50 * TICKS },
    }),
    25,
  );
  assert.equal(resolveProgress({ UserData: { PlayedPercentage: 12 } }), 12);
  assert.equal(resolveProgress({}), 0);
  assert.equal(
    resolveProgress({
      RunTimeTicks: 10 * TICKS,
      UserData: { PlaybackPositionTicks: 50 * TICKS },
    }),
    100,
  );
});

test("观看时间收成毫秒精度的 UTC，无时区按 UTC，空日期和乱字丢掉", () => {
  assert.equal(normalizePlayedAt("2026-10-08T15:04:05.1234567Z"), "2026-10-08T15:04:05.123Z");
  assert.equal(normalizePlayedAt("2026-10-08T23:04:05.0000000+08:00"), "2026-10-08T15:04:05.000Z");
  assert.equal(normalizePlayedAt("2026-10-08T15:04:05"), "2026-10-08T15:04:05.000Z");
  assert.equal(normalizePlayedAt("0001-01-01T00:00:00.0000000Z"), null);
  assert.equal(normalizePlayedAt(""), null);
  assert.equal(normalizePlayedAt(null), null);
  assert.equal(normalizePlayedAt("not a date"), null);
});
