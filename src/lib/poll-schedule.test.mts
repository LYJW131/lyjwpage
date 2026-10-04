import assert from "node:assert/strict";
import { test } from "node:test";

import {
  LAG_GRACE_MS,
  LAG_MIN_RETRY_MS,
  PUSH_SAFETY_NET_MS,
  fallbackOutlived,
  lagOverdue,
  nextLagDelay,
  realtimeInterval,
} from "@/lib/poll-schedule";
import { STATUS_VIEWS, cadenceOfPath, isPushedViewPath, isRealtimeViewPath, pushCoversPath } from "@/lib/status-views";

const MIN = 60_000;

test("可滞后层排在下一次预期写入之后几秒", () => {
  const updatedAt = 1_000_000;
  assert.equal(nextLagDelay(updatedAt, 10 * MIN, updatedAt + 10_000), 10 * MIN - 10_000 + LAG_GRACE_MS);
});

test("写入方漏了一轮：从 15 秒起退避，封顶 min(节奏, 5 分钟)", () => {
  const updatedAt = 0;
  const due = MIN + LAG_GRACE_MS;
  assert.equal(nextLagDelay(updatedAt, MIN, due), LAG_MIN_RETRY_MS);
  assert.equal(nextLagDelay(updatedAt, MIN, due + 60_000), 30_000);
  assert.equal(nextLagDelay(updatedAt, MIN, due + 10 * MIN), MIN);
  assert.equal(nextLagDelay(updatedAt, 60 * MIN, 60 * MIN * 8), 5 * MIN);
});

test("没有 updatedAt 就按节奏本身取", () => {
  assert.equal(nextLagDelay(undefined, 6 * 60 * MIN, 123), 6 * 60 * MIN);
});

test("挂载补取只在过了预期写入时", () => {
  assert.equal(lagOverdue(0, MIN, MIN), false);
  assert.equal(lagOverdue(0, MIN, MIN + LAG_GRACE_MS), true);
  assert.equal(lagOverdue(undefined, MIN, 0), true);
});

test("实时层：推送连着且推送覆盖整份时退成 5 分钟兜底", () => {
  assert.equal(realtimeInterval(60_000, true, true), PUSH_SAFETY_NET_MS);
  assert.equal(realtimeInterval(10 * MIN, true, true), 10 * MIN);
  assert.equal(realtimeInterval(60_000, false, true), 60_000);
  assert.equal(realtimeInterval(60_000, true, false), 60_000);
  assert.equal(realtimeInterval(0, true, true), 0);
});

test("登记表：节奏按路径取，带心跳的实时卡不退成兜底", () => {
  assert.equal(cadenceOfPath(STATUS_VIEWS.githubChart.path), 10 * MIN);
  assert.equal(cadenceOfPath(STATUS_VIEWS.cloudflareWorkers.path), 2 * MIN);
  assert.equal(cadenceOfPath(STATUS_VIEWS.server.path), MIN);
  assert.equal(cadenceOfPath(STATUS_VIEWS.desktop.path), undefined);
  assert.equal(pushCoversPath(STATUS_VIEWS.listening.path), true);
  assert.equal(pushCoversPath(STATUS_VIEWS.desktop.path), false);
  assert.equal(pushCoversPath(STATUS_VIEWS.nowListening.path), false);
  assert.equal(pushCoversPath(STATUS_VIEWS.charger.path), false);
  assert.equal(isRealtimeViewPath(`${STATUS_VIEWS.trophies.path}?titleids=a`), true);
  assert.equal(isRealtimeViewPath(STATUS_VIEWS.server.path), false);
  assert.equal(isPushedViewPath(`${STATUS_VIEWS.trophies.path}?titleids=a`), true);
  assert.equal(isPushedViewPath(STATUS_VIEWS.pulse.path), false);
  assert.equal(isPushedViewPath(STATUS_VIEWS.coding.path), false);
  assert.equal(isPushedViewPath(STATUS_VIEWS.server.path), false);
});

test("关了挂载回源的实时视图：首屏那份放得比一个轮询间隔久才在挂载时补取", () => {
  const servedAt = 1_000_000;
  const interval = 30 * MIN;
  assert.equal(fallbackOutlived(servedAt, interval, servedAt + 5 * MIN), false, "刚出站的首屏照旧等第一次轮询");
  assert.equal(fallbackOutlived(servedAt, interval, servedAt + interval), true);
  assert.equal(fallbackOutlived(servedAt, interval, servedAt + 6 * 60 * MIN), true, "缓存里放了几个小时的首屏");
  assert.equal(fallbackOutlived(undefined, interval, servedAt), true, "不带出站时刻的信封当作太旧");
});
