import assert from "node:assert/strict";
import test from "node:test";

import { chargingBand, chargingWindowFeatures } from "@shared/pulse-charging";
import { changesWhere, longestRunSeconds, measuredWindow, secondsWhere } from "@shared/pulse-features";
import { gamingWindowFeatures } from "@shared/pulse-gaming";
import { watchingWindowFeatures } from "@shared/pulse-watching";

const T = 1_800_000_000_000;
const M = 60_000;
const W = { from: T, to: T + 5 * M };

test("measuredWindow 裁窗并段，静默留成 unknown", () => {
  const view = measuredWindow([
    { t: T - M, level: 3, hint: "A", until: T + M },
    { t: T + M, level: 3, hint: "A", until: T + 2 * M },
    // T+2m → T+3m 没有样本：静默
    { t: T + 3 * M, level: 0, until: T + 5 * M },
  ], W);
  assert.deepEqual(view.runs, [
    { from: T, to: T + 2 * M, level: 3, hint: "A" },
    { from: T + 3 * M, to: T + 5 * M, level: 0 },
  ]);
  assert.deepEqual(view.coverage, [{ from: T, to: T + 2 * M }, { from: T + 3 * M, to: T + 5 * M }]);
  assert.equal(view.observedSeconds, 240);
  assert.equal(view.unknownSeconds, 60);
});

test("最长连续段只累加首尾相接的段，切换与断口都算断", () => {
  const runs = measuredWindow([
    { t: T, level: 3, hint: "A", until: T + M },
    { t: T + M, level: 3, hint: "B", until: T + 3 * M },
    { t: T + 3 * M, level: 2, hint: "B", until: T + 4 * M },
    { t: T + 4 * M, level: 3, hint: "C", until: T + 5 * M },
  ], W).runs;
  const playing = (run: { level: number }) => run.level === 3;
  assert.equal(secondsWhere(runs, playing), 240);
  assert.equal(longestRunSeconds(runs, playing), 180, "A→B 连着播算一段，暂停打断");
  assert.equal(changesWhere(runs, (run) => run.level >= 2), 2, "A→B、B(暂停)→C 各一次；B 播→B 暂停不是切歌");
});

test("隔着静默的两首不算一次切歌", () => {
  const runs = measuredWindow([
    { t: T, level: 3, hint: "A", until: T + M },
    { t: T + 3 * M, level: 3, hint: "B", until: T + 5 * M },
  ], W).runs;
  assert.equal(changesWhere(runs, (run) => run.level === 3), 0);
  assert.equal(longestRunSeconds(runs, (run) => run.level === 3), 120);
});

test("charging：瓦数分档在代码里算，旧档位样本按档位", () => {
  assert.equal(chargingBand({ from: 0, to: 1, level: 0, powerW: 0 }), "unplugged");
  assert.equal(chargingBand({ from: 0, to: 1, level: 0, powerW: 5 }), "trickle");
  assert.equal(chargingBand({ from: 0, to: 1, level: 0, powerW: 15 }), "moderate");
  assert.equal(chargingBand({ from: 0, to: 1, level: 0, powerW: 60 }), "high");
  assert.equal(chargingBand({ from: 0, to: 1, level: 2 }), "moderate");
  const { features } = chargingWindowFeatures([
    { t: T, level: 3, powerW: 72.5, until: T + 2 * M },
    { t: T + 2 * M, level: 0, powerW: 0, until: T + 5 * M },
  ], W);
  assert.deepEqual(features.secondsByBand, { unplugged: 180, trickle: 0, moderate: 0, high: 120 });
  assert.equal(features.peakWatts, 72.5);
  assert.equal(features.longestPoweredRunSeconds, 120);
});

test("gaming：主机在线未进游戏单独成桶，不算游戏", () => {
  const { features } = gamingWindowFeatures([
    { t: T, level: 1, until: T + 2 * M },
    { t: T + 2 * M, level: 3, hint: "Pragmata", until: T + 5 * M },
  ], W);
  assert.equal(features.onlineIdleSeconds, 120);
  assert.equal(features.inGameSeconds, 180);
  assert.deepEqual(features.games, [{ title: "Pragmata", seconds: 180 }]);
});

test("watching：暂停不算观看，标题切换计数", () => {
  const { features } = watchingWindowFeatures([
    { t: T, level: 3, hint: "Ep 1", until: T + 2 * M },
    { t: T + 2 * M, level: 3, hint: "Ep 2", until: T + 4 * M },
    { t: T + 4 * M, level: 2, hint: "Ep 2", until: T + 5 * M },
  ], W);
  assert.equal(features.playingSeconds, 240);
  assert.equal(features.pausedSeconds, 60);
  assert.equal(features.titleChanges, 1);
  assert.deepEqual(features.titles.map((item) => item.title), ["Ep 2", "Ep 1"]);
});
