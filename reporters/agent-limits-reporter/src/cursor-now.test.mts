import assert from "node:assert/strict";
import test from "node:test";

import { latestActivity } from "../dist/cursor-now.js";

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
