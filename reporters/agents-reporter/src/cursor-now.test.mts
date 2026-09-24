import assert from "node:assert/strict";
import test from "node:test";

import { latestActivity, markCursorNowSent, nextActivityInterval, observeCursorActivity } from "../dist/cursor-now.js";

const lower = Date.parse("2026-09-23T00:00:00Z");
const upper = lower + 15 * 60_000;

test("取窗口内最新的一条，bot 也算，缺 token 分列的事件照样认", () => {
  const body = {
    usageEventsDisplay: [
      { timestamp: String(lower + 60_000), model: "grok-4.7-xhigh", tokenUsage: { inputTokens: 1 } },
      { timestamp: String(lower + 120_000), model: "github_bugbot" },
      { timestamp: String(upper + 1), model: "future" },
      { timestamp: "junk", model: "bad" },
    ],
  };
  assert.deepEqual(latestActivity(body, lower, upper), {
    lastActivityAt: new Date(lower + 120_000).toISOString(),
    currentModel: "github_bugbot",
  });
});

test("没有事件返回 null（Cursor 会把空数组整个省掉），结构不对才报错", () => {
  assert.equal(latestActivity({ usageEventsDisplay: [] }, lower, upper), null);
  assert.equal(latestActivity({ totalUsageEventsCount: 0 }, lower, upper), null);
  assert.throws(() => latestActivity(null, lower, upper));
  assert.throws(() => latestActivity({ usageEventsDisplay: "x" }, lower, upper));
});

test("有新事件回到 1 分钟，没有就翻倍，封顶 4 分钟", () => {
  assert.equal(nextActivityInterval(60_000, false), 120_000);
  assert.equal(nextActivityInterval(120_000, false), 240_000);
  assert.equal(nextActivityInterval(240_000, false), 240_000);
  assert.equal(nextActivityInterval(240_000, true), 60_000);
});

test("同一条事件发出去之后不再重复带", () => {
  const now = Date.parse("2026-09-23T00:10:00Z");
  const latest = { lastActivityAt: "2026-09-23T00:09:00.000Z", currentModel: "github_bugbot" };
  assert.deepEqual(observeCursorActivity(latest, now), latest);
  // 没发成功时下一轮照样带
  assert.deepEqual(observeCursorActivity(latest, now), latest);
  markCursorNowSent(latest);
  assert.equal(observeCursorActivity(latest, now), null);
  assert.equal(observeCursorActivity(null, now), null);
});
