import assert from "node:assert/strict";
import test from "node:test";

import { addDays } from "./github-chart-compact.ts";
import {
  diffDays,
  heatmapRefreshFrom,
  isHeatmapFuture,
  lastHeatmapDate,
  mergeHeatmapSeries,
  sliceHeatmapWindow,
  utcToday,
  zonedDay,
} from "./heatmap-window.ts";

const ORIGIN = "2025-08-17";

test("since 在窗口里才切尾，含当天", () => {
  const last = addDays(ORIGIN, 370);
  const slice = sliceHeatmapWindow(ORIGIN, 371, last);
  assert.deepEqual(slice, { partial: true, fromIndex: 370 });
  assert.equal(sliceHeatmapWindow(ORIGIN, 371, addDays(ORIGIN, -1)).partial, false);
  assert.equal(sliceHeatmapWindow(ORIGIN, 371, addDays(ORIGIN, 371)).partial, false);
  assert.equal(sliceHeatmapWindow(ORIGIN, 371, "nope").partial, false);
});

test("原点前滚时丢掉出窗前缀，尾巴接到 from", () => {
  const local = Array.from({ length: 371 }, (_, index) => index);
  const nextOrigin = addDays(ORIGIN, 7);
  const from = addDays(nextOrigin, 364);
  const merged = mergeHeatmapSeries(local, ORIGIN, {
    origin: nextOrigin,
    from,
    values: [900, 901, 902, 903, 904, 905, 906],
    partial: true,
  });
  assert.equal(merged.origin, nextOrigin);
  assert.equal(merged.values.length, 371);
  assert.equal(merged.values[0], 7);
  assert.equal(merged.values[363], 370);
  assert.deepEqual(merged.values.slice(364), [900, 901, 902, 903, 904, 905, 906]);
});

test("同一窗口只覆盖从 since 起的几天", () => {
  const local = Array.from({ length: 8 }, (_, index) => index + 1);
  const merged = mergeHeatmapSeries(local, ORIGIN, {
    origin: ORIGIN,
    from: addDays(ORIGIN, 6),
    values: [70, 80],
    partial: true,
  });
  assert.deepEqual(merged.values, [1, 2, 3, 4, 5, 6, 70, 80]);
});

test("没有本地前缀的增量当整份用", () => {
  const merged = mergeHeatmapSeries(undefined, undefined, {
    origin: ORIGIN,
    from: addDays(ORIGIN, 370),
    values: [3],
    partial: true,
  });
  assert.deepEqual(merged.values, [3]);
});

test("lastHeatmapDate 是 origin 起最后一天", () => {
  assert.equal(lastHeatmapDate(ORIGIN, 371), addDays(ORIGIN, 370));
  assert.equal(lastHeatmapDate("", 10), null);
  assert.equal(diffDays(ORIGIN, addDays(ORIGIN, 7)), 7);
});

test("今天之后的格子算未来", () => {
  assert.equal(isHeatmapFuture("2026-08-26", "2026-08-26"), false);
  assert.equal(isHeatmapFuture("2026-08-25", "2026-08-26"), false);
  assert.equal(isHeatmapFuture("2026-08-27", "2026-08-26"), true);
});

test("游标从今天切到窗尾，不锁在未来的空格上", () => {
  const origin = "2025-08-24";
  const from = heatmapRefreshFrom(origin, 371, "2026-08-24");
  assert.equal(from, "2026-08-24");
  const slice = sliceHeatmapWindow(origin, 371, from ?? undefined);
  assert.equal(slice.fromIndex, 365);
  assert.equal(371 - slice.fromIndex, 6);
  assert.equal(heatmapRefreshFrom(origin, 371, "2026-08-29"), "2026-08-29");
});

test("切窗按采集侧时区的日历，不按 UTC", () => {
  // 东八区 08-27 03:17，UTC 还是 08-26：拿 UTC 切会把今天那格连数字一起切掉
  const pushedAt = Date.parse("2026-08-26T19:17:30Z");
  assert.equal(utcToday(pushedAt), "2026-08-26");
  assert.equal(zonedDay(pushedAt, "Asia/Shanghai"), "2026-08-27");
  assert.equal(isHeatmapFuture("2026-08-27", zonedDay(pushedAt, "Asia/Shanghai")), false);
  assert.equal(isHeatmapFuture("2026-08-28", zonedDay(pushedAt, "Asia/Shanghai")), true);
});
