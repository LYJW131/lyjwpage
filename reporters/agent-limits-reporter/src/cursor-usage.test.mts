import assert from "node:assert/strict";
import test from "node:test";

import { estimateCursorCost } from "../dist/cursor-pricing.js";
import {
  aggregateEvents,
  applyLedger,
  parseUsagePage,
  reconcilePages,
  sessionFromAccessToken,
  shanghaiDay,
} from "../dist/cursor-usage.js";

function jwt(sub: string): string {
  const payload = Buffer.from(JSON.stringify({ sub })).toString("base64url");
  return `aaa.${payload}.bbb`;
}

function event(timestamp: string, model: string, input: number) {
  return {
    timestamp,
    model,
    tokenUsage: { inputTokens: input, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    isTokenBasedCall: true,
  };
}

test("sessionFromAccessToken 用 sub 里的 user id 拼 Mac 同一份 cookie", () => {
  const token = jwt("auth0|user_fixture");
  const session = sessionFromAccessToken(token);
  assert.equal(session.cookie, `WorkosCursorSessionToken=user_fixture%3A%3A${token}`);
  assert.equal(session.accountHash, sessionFromAccessToken(jwt("auth0|user_fixture")).accountHash);
  assert.notEqual(session.accountHash, sessionFromAccessToken(jwt("auth0|user_other")).accountHash);
  assert.throws(() => sessionFromAccessToken("not-a-jwt"));
});

test("分页重叠只删服务端总数证明多余的那一段", () => {
  const page = (rows: ReturnType<typeof event>[], total: number) =>
    parseUsagePage({ totalUsageEventsCount: total, usageEventsDisplay: rows }, 0, 10_000);
  const first = page([event("1000", "gpt-5", 1), event("2000", "gpt-5", 2)], 3);
  const second = page([event("2000", "gpt-5", 2), event("3000", "gpt-5", 3)], 3);
  const merged = reconcilePages([first.events, second.events], 3);
  assert.deepEqual(merged.map((row) => row.timestampMs), [1000, 2000, 3000]);
  assert.equal(reconcilePages([first.events, first.events], 2).map((row) => row.timestampMs).join(","), "1000,2000");
  assert.throws(() => reconcilePages([first.events, second.events], 2));
});

test("事件按上海自然日分桶，缓存写入单独计，套餐扣费不当估价", () => {
  const stamp = Date.parse("2026-09-04T16:30:00Z");
  assert.equal(shanghaiDay(stamp), "2026-09-05");
  const parsed = parseUsagePage(
    {
      totalUsageEventsCount: 1,
      usageEventsDisplay: [
        {
          timestamp: String(stamp),
          model: "claude-4.5-sonnet-thinking",
          tokenUsage: {
            inputTokens: 1_000_000,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            totalCents: 99900,
          },
          chargedCents: 999900,
          isTokenBasedCall: true,
        },
      ],
    },
    0,
    stamp,
  );
  const aggregated = aggregateEvents(parsed.events, stamp);
  assert.equal(aggregated.days[0]?.date, "2026-09-05");
  assert.equal(aggregated.days[0]?.inputTokens, 1_000_000);
  assert.equal(aggregated.days[0]?.cacheCreationTokens, 0);
  assert.equal(aggregated.costComplete, true);
  assert.equal(aggregated.days[0]?.apiEquivalentCostUSD, 3);
  assert.equal(aggregated.days[0]?.models[0]?.model, "claude-4.5-sonnet-thinking");
});

test("云端没再返回的旧活动日留在账本里，并标成不完整", () => {
  const kept = {
    date: "2026-08-01",
    inputTokens: 5,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 5,
    apiEquivalentCostUSD: 0,
    costComplete: true,
    models: [{ model: "gpt-5", tokens: 5 }],
  };
  const incoming = {
    ...kept,
    date: "2026-09-05",
    inputTokens: 2,
    totalTokens: 2,
    models: [{ model: "gpt-5", tokens: 2 }],
  };
  const applied = applyLedger(
    { version: 1, accountHash: "same", collectedAt: "2026-09-01T00:00:00.000Z", days: { "2026-08-01": kept } },
    "same",
    [incoming],
    "2026-09-05T04:00:00.000Z",
    true,
    0,
  );
  assert.equal(applied.push.days.find((day) => day.date === "2026-08-01")?.totalTokens, 5);
  assert.equal(applied.push.state, "error");
  assert.match(applied.push.error ?? "", /Kept 1/);
  assert.equal(applied.push.costComplete, false);
});

test("估价别名和长上下文门槛跟 Mac 的快照一致", () => {
  const at = Date.parse("2026-09-05T12:00:00Z");
  assert.equal(
    estimateCursorCost("claude-sonnet-4-5", 1_000_000, 1_000_000, 1_000_000, 1_000_000, at),
    3 + 15 + 0.3 + 3.75,
  );
  assert.equal(
    estimateCursorCost("claude-4.5-sonnet-thinking", 1_000, 2_000, 0, 0, at),
    estimateCursorCost("claude-sonnet-4-5", 1_000, 2_000, 0, 0, at),
  );
  assert.equal(estimateCursorCost("auto", 1_000, 0, 0, 0, at), null);
  assert.equal(estimateCursorCost("gpt-5.5", 20_000, 1_000, 252_000, 0, at), 0.1 + 0.03 + 0.126);
  assert.equal(estimateCursorCost("gpt-5.5", 1_000, 2_000, 0, 1, at), null);
});
