import assert from "node:assert/strict";
import test from "node:test";

import { PULSE_SILENT_AFTER_MS, PULSE_WINDOW_MS } from "@/lib/limits";
import {
  buildPulseState,
  clipPulseSamples,
  compressPulseWindow,
  pulseQuestions,
  pulseWindowAt,
} from "@/lib/pulse-window";
import type { PulseSample } from "@/lib/types";

const NOW = 1_770_000_000_000;
const WINDOW = pulseWindowAt(NOW);
const HOUR = 3_600_000;

test("窗口是最近 24 小时，起点就是终点减窗口长", () => {
  assert.equal(WINDOW.to, NOW);
  assert.equal(WINDOW.to - WINDOW.from, PULSE_WINDOW_MS);
});

/** 段的端点写成「距窗口起点多少分钟」，读起来和喂给 Jev 的那份是同一套坐标 */
function minutes(view: ReturnType<typeof compressPulseWindow>) {
  return view.segments.map((segment) => [
    (segment.from - WINDOW.from) / 60_000,
    (segment.to - WINDOW.from) / 60_000,
    segment.level,
    segment.hint ?? null,
  ]);
}

test("阶跃样本压成段，每档分钟数按段长累加", () => {
  const samples: PulseSample[] = [
    { t: WINDOW.from + HOUR, level: 3, hint: "Song" },
    // 5 分钟后的再确认：同档同 hint，并进上一段，段尾跟着往后挪
    { t: WINDOW.from + HOUR + 5 * 60_000, level: 3, hint: "Song" },
    { t: WINDOW.from + HOUR + 10 * 60_000, level: 0 },
    { t: NOW - 3 * 60_000, level: 2, hint: "Zed" },
  ];
  const view = compressPulseWindow(samples, WINDOW);

  assert.deepEqual(minutes(view), [
    [60, 70, 3, "Song"],
    [70, 1437, 0, null],
    [1437, 1440, 2, "Zed"],
  ]);
  assert.deepEqual(view.minutesByLevel, [1367, 0, 3, 10]);
  assert.equal(view.latestSampleAt, NOW - 3 * 60_000);
});

test("非空闲样本停在静默上限，右端如实空着而不是连到此刻", () => {
  const view = compressPulseWindow([{ t: NOW - 40 * 60_000, level: 3 }], WINDOW);
  assert.deepEqual(minutes(view), [[1400, 1410, 3, null]]);
});

test("非空闲样本超过静默上限就断开，不把一夜算成满档", () => {
  const samples: PulseSample[] = [{ t: WINDOW.from + HOUR, level: 3 }];
  const view = compressPulseWindow(samples, WINDOW);
  assert.equal(view.segments.length, 1);
  assert.equal(view.segments[0].to - view.segments[0].from, PULSE_SILENT_AFTER_MS);
  assert.deepEqual(view.minutesByLevel, [0, 0, 0, PULSE_SILENT_AFTER_MS / 60_000]);
});

test("空闲样本不受静默上限约束，一直撑到窗口末端", () => {
  const view = compressPulseWindow([{ t: WINDOW.from + HOUR, level: 0 }], WINDOW);
  assert.deepEqual(view.minutesByLevel, [23 * 60, 0, 0, 0]);
});

test("窗口左边界之前的最后一笔照样算，段的起点裁到窗口起点", () => {
  const view = compressPulseWindow([
    { t: WINDOW.from - 5 * HOUR, level: 0 },
    { t: WINDOW.from + HOUR, level: 3 },
  ], WINDOW);
  assert.deepEqual(minutes(view), [
    [0, 60, 0, null],
    [60, 70, 3, null],
  ]);
  assert.equal(view.latestSampleAt, WINDOW.from + HOUR);
});

test("边界之前那笔非空闲、又早过静默上限时什么都不画", () => {
  const view = compressPulseWindow([{ t: WINDOW.from - HOUR, level: 3 }], WINDOW);
  assert.deepEqual(view.segments, []);
  assert.deepEqual(view.minutesByLevel, [0, 0, 0, 0]);
  // 序列里确实有这笔，只是撑不到窗口里；评分器仍据此判断「有没有新东西」
  assert.equal(view.latestSampleAt, WINDOW.from - HOUR);
});

test("公开样本剥掉 hint，并把边界前那一笔压到窗口起点", () => {
  const clipped = clipPulseSamples([
    { t: WINDOW.from - 10 * HOUR, level: 3, hint: "老的" },
    { t: WINDOW.from - HOUR, level: 0 },
    { t: WINDOW.from + HOUR, level: 3, hint: "Song" },
    { t: NOW + 60_000, level: 0 },
  ], WINDOW);
  assert.deepEqual(clipped, [
    { t: WINDOW.from, level: 0 },
    { t: WINDOW.from + HOUR, level: 3 },
  ]);
  assert.equal(JSON.stringify(clipped).includes("hint"), false);
});

test("边界前那一笔陈旧到撑不进窗口时一并丢掉，泳道左沿如实空着", () => {
  // 昨夜停在「正在放」、之后再没上报：段压器什么都不画，公开样本也不该留这一笔
  assert.deepEqual(clipPulseSamples([{ t: WINDOW.from - HOUR, level: 3 }], WINDOW), []);
  // 刚过边界不久的非空闲还撑得进来，照留
  assert.deepEqual(
    clipPulseSamples([{ t: WINDOW.from - 60_000, level: 3 }], WINDOW),
    [{ t: WINDOW.from, level: 3 }],
  );
});

test("state 里的时刻是距窗口起点的分钟数，hint 只在有的时候多一项", () => {
  const view = compressPulseWindow([
    { t: WINDOW.from + HOUR, level: 3, hint: "Song" },
    { t: WINDOW.from + 2 * HOUR, level: 0 },
  ], WINDOW);
  const empty = compressPulseWindow([], WINDOW);
  const state = buildPulseState(
    { coding: empty, listening: view, watching: empty, gaming: empty, charging: empty, activity: empty },
    WINDOW,
  ) as { window: { hours: number }; domains: Record<string, { segments: unknown[][] }> };

  assert.equal(state.window.hours, 24);
  assert.deepEqual(state.domains.listening.segments, [[60, 70, 3, "Song"], [120, 1440, 0]]);
  assert.deepEqual(state.domains.coding.segments, []);
});

test("六个域各两道题，分档标尺是低到高的四档", () => {
  const questions = pulseQuestions();
  assert.equal(Object.keys(questions).length, 12);
  const activity = questions.codingActivity;
  assert.equal(activity.type, "score");
  assert.equal(activity.type === "score" && activity.criteria.length, 4);
  const trend = questions.gamingTrend;
  assert.equal(trend.type, "choice");
  assert.deepEqual(trend.type === "choice" && Object.keys(trend.criteria), ["rising", "steady", "falling"]);
});
