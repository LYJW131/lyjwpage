import assert from "node:assert/strict";
import { test } from "node:test";

import {
  RECONNECT_MAX_MS,
  STABLE_CONNECTION_MS,
  attemptsAfterClose,
  catchUpOnOpen,
  catchUpOnVisible,
  reconnectDelay,
} from "@/lib/live-reconnect";
import { STATUS_VIEWS, isPushedViewPath } from "@/lib/status-views";

test("退避从 1 秒起每次 ×1.5、封顶 30 秒，抖动只落在上半截", () => {
  assert.equal(reconnectDelay(0, 1), 1_000);
  assert.equal(reconnectDelay(0, 0), 500);
  assert.equal(reconnectDelay(2, 1), 2_250);
  assert.equal(reconnectDelay(50, 1), RECONNECT_MAX_MS);
  assert.equal(reconnectDelay(50, 0), RECONNECT_MAX_MS / 2);
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const ceiling = Math.min(1_000 * 1.5 ** attempt, RECONNECT_MAX_MS);
    const delay = reconnectDelay(attempt, Math.random());
    assert.ok(delay >= ceiling / 2 && delay <= ceiling, `attempt ${attempt}: ${delay}`);
  }
});

test("连上很快又断不清零退避，撑过稳定时长才清零", () => {
  const openedAt = 1_000_000;
  assert.equal(attemptsAfterClose(5, openedAt, openedAt + 200), 5);
  assert.equal(attemptsAfterClose(5, openedAt, openedAt + STABLE_CONNECTION_MS - 1), 5);
  assert.equal(attemptsAfterClose(5, openedAt, openedAt + STABLE_CONNECTION_MS), 0);
  assert.equal(attemptsAfterClose(5, null, openedAt), 5, "握手都没成功的失败照样累加");
});

test("一个反复被断的后台页：退避一路涨到封顶，不会回到 1 秒一轮", () => {
  let attempts = 0;
  let now = 0;
  const delays: number[] = [];
  for (let round = 0; round < 15; round += 1) {
    const openedAt = now;
    now += 500;
    attempts = attemptsAfterClose(attempts, openedAt, now);
    const delay = reconnectDelay(attempts, 0.5);
    delays.push(delay);
    attempts += 1;
    now += delay;
  }
  assert.ok(delays.every((delay, i) => i === 0 || delay >= delays[i - 1]));
  assert.ok(delays.at(-1)! >= RECONNECT_MAX_MS * 0.75);
});

test("首次连上不补取", () => {
  assert.deepEqual(catchUpOnOpen({ reconnect: false, visible: true, pending: false }), { refetch: false, pending: false });
  assert.deepEqual(catchUpOnOpen({ reconnect: false, visible: false, pending: false }), { refetch: false, pending: false });
});

test("前台重连立刻补取；后台重连只记待补", () => {
  assert.deepEqual(catchUpOnOpen({ reconnect: true, visible: true, pending: false }), { refetch: true, pending: false });
  assert.deepEqual(catchUpOnOpen({ reconnect: true, visible: false, pending: false }), { refetch: false, pending: true });
});

test("后台连断多次只留一笔待补，回到前台补一次", () => {
  let pending = false;
  let refetches = 0;
  for (let round = 0; round < 10; round += 1) {
    const step = catchUpOnOpen({ reconnect: true, visible: false, pending });
    pending = step.pending;
    if (step.refetch) refetches += 1;
  }
  assert.equal(refetches, 0);
  assert.equal(pending, true);
  const back = catchUpOnVisible({ pending, visible: true, socketOpen: true });
  assert.deepEqual(back, { refetch: true, pending: false });
  assert.deepEqual(catchUpOnVisible({ pending: back.pending, visible: true, socketOpen: true }), { refetch: false, pending: false });
});

test("回到前台时连接还没通：待补留着，等连上那一刻补", () => {
  const back = catchUpOnVisible({ pending: true, visible: true, socketOpen: false });
  assert.deepEqual(back, { refetch: false, pending: true });
  assert.deepEqual(catchUpOnOpen({ reconnect: true, visible: true, pending: back.pending }), { refetch: true, pending: false });
});

test("没有待补或仍在后台时，可见性变化不回源", () => {
  assert.deepEqual(catchUpOnVisible({ pending: false, visible: true, socketOpen: true }), { refetch: false, pending: false });
  assert.deepEqual(catchUpOnVisible({ pending: true, visible: false, socketOpen: true }), { refetch: false, pending: true });
});

test("补取只针对带推送事件的视图，不含 pulse 与 coding 用量", () => {
  const pushed = Object.values(STATUS_VIEWS).filter((view) => isPushedViewPath(view.path)).map((view) => view.path);
  assert.ok(pushed.includes(STATUS_VIEWS.nowListening.path));
  assert.ok(isPushedViewPath(`${STATUS_VIEWS.trophies.path}?titleids=a`));
  for (const view of [STATUS_VIEWS.pulse, STATUS_VIEWS.coding, STATUS_VIEWS.codingYear, STATUS_VIEWS.server]) {
    assert.equal(isPushedViewPath(view.path), false, view.path);
  }
  assert.equal(pushed.length, Object.values(STATUS_VIEWS).filter((view) => "event" in view).length);
});
