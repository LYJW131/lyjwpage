import assert from "node:assert/strict";
import test from "node:test";

import { nextObservation, type Observation } from "./apple-music-observation.ts";

const GAP = 135_000;
const T = 1_700_000_000_000;

test("第一次看见：不知道它是什么时候换上来的", () => {
  assert.deepEqual(nextObservation(null, "a", T, GAP), {
    id: "a",
    switchedAt: null,
    observedAt: T,
  });
});

test("连着看的过程中换了人：此刻就是换上来的时刻", () => {
  const previous: Observation = { id: "a", switchedAt: null, observedAt: T };
  assert.deepEqual(nextObservation(previous, "b", T + 45_000, GAP), {
    id: "b",
    switchedAt: T + 45_000,
    observedAt: T + 45_000,
  });
});

test("隔太久才又看一眼，换了人也不认时刻 —— 宁可漏报，不可误报", () => {
  const previous: Observation = { id: "a", switchedAt: T, observedAt: T };
  const seen = nextObservation(previous, "b", T + GAP + 1, GAP);
  assert.equal(seen.switchedAt, null);
  assert.equal(seen.observedAt, T + GAP + 1);
});

test("正好卡在窗口上仍算连着 —— 边界归连续那边", () => {
  const previous: Observation = { id: "a", switchedAt: null, observedAt: T };
  assert.equal(nextObservation(previous, "b", T + GAP, GAP).switchedAt, T + GAP);
});

test("同一项还在最前：沿用换上来那一刻，只把观测时刻续上", () => {
  const previous: Observation = { id: "a", switchedAt: T, observedAt: T + 45_000 };
  assert.deepEqual(nextObservation(previous, "a", T + 90_000, GAP), {
    id: "a",
    switchedAt: T,
    observedAt: T + 90_000,
  });
});

test("同一项还在最前，中间断过一截也沿用 —— 一直排第一说明没换过东西", () => {
  const previous: Observation = { id: "a", switchedAt: T, observedAt: T + 45_000 };
  assert.equal(nextObservation(previous, "a", T + 3_600_000, GAP).switchedAt, T);
});

test("不知道换上来时刻的那一项，重新看见还是不知道", () => {
  const previous: Observation = { id: "a", switchedAt: null, observedAt: T };
  assert.equal(nextObservation(previous, "a", T + 45_000, GAP).switchedAt, null);
});
