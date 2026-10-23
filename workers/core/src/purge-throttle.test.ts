import assert from "node:assert/strict";
import test from "node:test";

import { PURGE_MIN_INTERVAL_MS, addPending, planPurge, purgeSlot } from "./purge-throttle";

const T = 1_800_000_000_000;

test("上一轮清过不到间隔，新失效排到间隔满的那一刻", () => {
  assert.equal(purgeSlot(0, T), T);
  assert.equal(purgeSlot(T, T + 1_000), T + PURGE_MIN_INTERVAL_MS);
  assert.equal(purgeSlot(T, T + PURGE_MIN_INTERVAL_MS + 5), T + PURGE_MIN_INTERVAL_MS + 5);
});

test("排队的标签去重合并", () => {
  assert.deepEqual(addPending(["charger"], ["charger", "home", "charger"]), ["charger", "home"]);
});

test("间隔内不清，排着的和到期的补失效都等到间隔满", () => {
  const state = { pending: ["charger"], lag: { server: T }, flushedAt: T - 1_000 };
  assert.deepEqual(planPurge(state, T), { due: [], state, next: T - 1_000 + PURGE_MIN_INTERVAL_MS });
});

test("间隔满后，排着的标签与到期的补失效合成一轮，没到期的补失效至少再隔一个间隔", () => {
  const plan = planPurge({
    pending: ["charger", "server"],
    lag: { server: T - 1, limits: T + 1_000 },
    flushedAt: T - PURGE_MIN_INTERVAL_MS,
  }, T);
  assert.deepEqual(plan.due, ["charger", "server"]);
  assert.deepEqual(plan.state, { pending: [], lag: { limits: T + 1_000 }, flushedAt: T });
  assert.equal(plan.next, T + PURGE_MIN_INTERVAL_MS);
});

test("没有要清的就不占这一轮", () => {
  const state = { pending: [], lag: { limits: T + 90_000 }, flushedAt: 0 };
  assert.deepEqual(planPurge(state, T), { due: [], state, next: T + 90_000 });
  const empty = { pending: [], lag: {}, flushedAt: 0 };
  assert.deepEqual(planPurge(empty, T), { due: [], state: empty, next: null });
});

test("充电头在门槛两侧来回跳时，一分钟里最多清两轮", () => {
  let state = { pending: [] as string[], lag: {}, flushedAt: 0 };
  let rounds = 0;
  for (let at = T; at < T + 60_000; at += 6_000) {
    state = { ...state, pending: addPending(state.pending, ["charger"]) };
    const plan = planPurge(state, at);
    if (plan.due.length) rounds += 1;
    state = plan.state;
  }
  assert.equal(rounds, 2);
});
