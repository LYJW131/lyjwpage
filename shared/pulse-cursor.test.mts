import assert from "node:assert/strict";
import test from "node:test";

import {
  CURSOR_ACTIVITY_HOLD_MS,
  CURSOR_OBSERVATION_HOLD_MS,
  cursorWindowFeatures,
  parseCursorObservation,
  type CursorObservation,
} from "./pulse-cursor.ts";

test("parseCursorObservation：只认齐三字段的形状，坏 JSON 与缺字段都返回 null", () => {
  assert.deepEqual(parseCursorObservation('{"t":1000,"available":true,"lastActivityAt":900}'), {
    t: 1000,
    available: true,
    lastActivityAt: 900,
  });
  assert.deepEqual(parseCursorObservation('{"t":1,"available":false,"lastActivityAt":null}'), {
    t: 1,
    available: false,
    lastActivityAt: null,
  });
  assert.equal(parseCursorObservation("{"), null);
  assert.equal(parseCursorObservation('{"t":"1","available":true,"lastActivityAt":null}'), null);
  assert.equal(parseCursorObservation('{"t":1,"available":1,"lastActivityAt":null}'), null);
  assert.equal(parseCursorObservation('{"t":1,"available":true,"lastActivityAt":"x"}'), null);
  assert.equal(parseCursorObservation('{"t":1,"available":true}'), null);
  assert.equal(parseCursorObservation("null"), null);
});

const obs = (t: number, lastActivityAt: number | null = null, available = true): CursorObservation => ({
  t,
  available,
  lastActivityAt,
});

test("窗口特征：观测把保活窗裁剪进窗口，下一条观测截断上一条的保活", () => {
  const features = cursorWindowFeatures(
    [obs(0, 0), obs(200_000), obs(600_000, 590_000, false), obs(700_000, 700_000)],
    { from: 10_000, to: 500_000 },
  );
  assert.deepEqual(features, {
    coverage: [{ from: 10_000, to: 500_000 }],
    activeCoverage: [{ from: 10_000, to: 200_000 }],
    cursorObservedSeconds: 490,
    cursorActiveSeconds: 190,
    longestCursorRunSeconds: 190,
  });
});

test("窗口特征：不可用的行不留覆盖，活动时长按活动保活窗截断", () => {
  const features = cursorWindowFeatures(
    [obs(0, 0), obs(100_000, null, false), obs(1_000_000, 950_000)],
    { from: 0, to: 2_000_000 },
  );
  assert.deepEqual(features, {
    coverage: [{ from: 0, to: 100_000 }, { from: 1_000_000, to: 2_000_000 }],
    activeCoverage: [{ from: 0, to: 100_000 }, { from: 1_000_000, to: 1_250_000 }],
    cursorObservedSeconds: 1_100,
    cursorActiveSeconds: 350,
    longestCursorRunSeconds: 250,
  });
});

test("窗口特征：活动时刻晚于观测时刻的行不算活跃，观测落在窗外不算覆盖", () => {
  const futureActivity = cursorWindowFeatures([obs(1_000, 2_000)], { from: 0, to: 6_000 });
  assert.deepEqual(futureActivity.coverage, [{ from: 1_000, to: 6_000 }]);
  assert.deepEqual(futureActivity.activeCoverage, []);
  assert.equal(futureActivity.cursorActiveSeconds, 0);
  assert.equal(futureActivity.longestCursorRunSeconds, 0);

  const outside = cursorWindowFeatures([obs(0, 0)], { from: CURSOR_OBSERVATION_HOLD_MS + 1, to: 2 * CURSOR_OBSERVATION_HOLD_MS });
  assert.deepEqual(outside.coverage, []);
  assert.equal(outside.cursorObservedSeconds, 0);

  const empty = cursorWindowFeatures([], { from: 0, to: 1_000 });
  assert.deepEqual(empty, {
    coverage: [],
    activeCoverage: [],
    cursorObservedSeconds: 0,
    cursorActiveSeconds: 0,
    longestCursorRunSeconds: 0,
  });
});

test("活动保活窗是 5 分钟：lastActivityAt 那一刻再续 5 分钟", () => {
  const features = cursorWindowFeatures([obs(0, 0)], { from: 0, to: 10 * 60_000 });
  assert.deepEqual(features.activeCoverage, [{ from: 0, to: CURSOR_ACTIVITY_HOLD_MS }]);
  assert.equal(features.cursorActiveSeconds, 300);
});
