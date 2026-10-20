import assert from "node:assert/strict";
import test from "node:test";

import type { LimitHistoryPoint } from "@shared/limit-history";
import { forecastLimit, recentRate, sampleForecast, usageIntervals } from "./limit-forecast.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const WEEK_MIN = 7 * 24 * 60;

// 窗口周一 0 点开始，每天 23:00 一次读数（UTC，测试里站点日按 UTC 切）。
const start = Date.UTC(2026, 9, 12);
const reset = (start + 7 * DAY) / 1000;
const weekly = (usedPercent: number) => ({ key: "weekly_all", label: null, group: null, windowMinutes: WEEK_MIN, usedPercent, resetsAt: reset });
const readings = (values: number[], resetsAt = reset, from = start): LimitHistoryPoint[] =>
  values.map((used, index) => [from + index * DAY + 23 * HOUR, used, resetsAt]);

test("a reading that drops means a reset happened, and only the part after it counts", () => {
  const intervals = usageIntervals([[0, 70, 100], [DAY, 12, 100 + 7 * 86_400]], 7 * DAY);
  assert.equal(intervals.length, 1);
  assert.equal(intervals[0]!.used, 12);
});

test("days that start out of quota do not drag the recent pace down", () => {
  const points: LimitHistoryPoint[] = [[0, 40, 9e9], [DAY, 100, 9e9], [2 * DAY, 100, 9e9], [3 * DAY, 100, 9e9]];
  assert.equal(recentRate(usageIntervals(points, 7 * DAY), 3 * DAY), null);
  const open: LimitHistoryPoint[] = [[0, 10, 9e9], [DAY, 30, 9e9], [2 * DAY, 100, 9e9]];
  assert.equal(recentRate(usageIntervals(open, 7 * DAY), 2 * DAY), 20 / DAY);
});

test("steady use at twice the even pace runs out halfway and locks the rest of the window", () => {
  const now = start + 2 * DAY;
  const forecast = forecastLimit(weekly(4 * 100 / 7), readings([200 / 7]), now)!;
  assert.ok(forecast.runOutAt != null);
  assert.ok(Math.abs(forecast.runOutAt - (start + 3.5 * DAY)) < 0.05 * DAY);
  assert.ok(Math.abs(forecast.lockedMs! - 3.5 * DAY) < 0.05 * DAY);
});

test("early in a window the previous week's pace stands in until the window has its own", () => {
  const previous = readings([10, 20, 30, 40], reset - 7 * 86_400, start - 7 * DAY);
  const now = start + 2 * HOUR;
  const forecast = forecastLimit(weekly(8), previous, now)!;
  assert.ok(forecast.rate! < 8 / (2 * HOUR) / 3);
  assert.equal(forecastLimit(weekly(8), [], now)!.rate, null);
});

test("a window that already ran out reports when it hit the line", () => {
  const forecast = forecastLimit(weekly(100), readings([40, 100]), start + 3 * DAY)!;
  assert.equal(forecast.ranOut, true);
  assert.equal(forecast.runOutAt, start + DAY + 23 * HOUR);
});

test("light use ends the window below the limit", () => {
  const forecast = forecastLimit(weekly(10), readings([5]), start + 2 * DAY)!;
  assert.equal(forecast.runOutAt, null);
  assert.ok(forecast.percentAtReset! > 30 && forecast.percentAtReset! < 40);
});

test("an archived reading newer than the live one is ignored, not read as a reset", () => {
  const readAt = start + 2 * DAY;
  const history: LimitHistoryPoint[] = [...readings([20]), [readAt + 5 * 60_000, 48, reset]];
  const forecast = forecastLimit(weekly(46), history, readAt)!;
  assert.deepEqual(forecast.window.at(-1), [readAt, 46]);
  assert.ok(forecast.rate! > 0);
  assert.equal(forecast.ranOut, false);
});

test("a mid-window speed-up or slow-down moves the forecast beyond the whole-window average", () => {
  const now = start + 5 * DAY + 12 * HOUR;
  const average = (used: number) => used / (now - start);
  const faster = forecastLimit(weekly(70), [...readings([2, 4, 6, 8, 10]), [now - HOUR, 69, reset]], now)!;
  assert.ok(faster.rate! > average(70) * 1.5);
  const slower = forecastLimit(weekly(66), readings([20, 40, 60, 62, 64]), now)!;
  assert.ok(slower.rate! < average(66) * 0.8);
});

test("steady use leaves the forecast at the window average", () => {
  const now = start + 4 * DAY;
  const forecast = forecastLimit(weekly(40), readings([10, 20, 30]), now)!;
  assert.ok(Math.abs(forecast.rate! * DAY - 10) < 0.5);
});

test("sampling the chart reads actual use before now, the projection after, and nothing once locked", () => {
  const now = start + 2 * DAY;
  const forecast = forecastLimit(weekly(4 * 100 / 7), readings([200 / 7]), now)!;
  const past = sampleForecast(forecast, start + 11.5 * HOUR);
  assert.equal(past.phase, "used");
  assert.ok(Math.abs(past.percent! - 100 / 7) < 0.01);
  const ahead = sampleForecast(forecast, now + DAY);
  assert.equal(ahead.phase, "projected");
  assert.ok(ahead.percent! > ahead.target!);
  const light = forecastLimit(weekly(10), readings([5]), now)!;
  assert.equal(sampleForecast(light, light.resetAt).target, 100);
  assert.deepEqual(
    { ...sampleForecast(forecast, forecast.runOutAt! + HOUR), even: 0 },
    { at: forecast.runOutAt! + HOUR, phase: "locked", percent: null, target: null, even: 0 },
  );
});
