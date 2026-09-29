import assert from "node:assert/strict";
import test from "node:test";

import { estimateCursorCost } from "../dist/cursor-pricing.js";
import { bucketStart, CODING_BUCKET_MS, MAX_DAY_MODELS, MAX_WINDOW_ROWS, OVERFLOW_MODEL } from "../dist/coding-usage.js";
import {
  aggregateBuckets,
  aggregateEvents,
  applyIncrementalLedger,
  applyLedger,
  cursorActivityReport,
  cursorBucketReport,
  failedUsage,
  fetchCursorHistory,
  incrementalSince,
  latestOf,
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

test("Cursor 零值响应省略字段时历史成功，错误对象和不完整分页仍拒绝", async () => {
  for (const body of [{}, { totalUsageEventsCount: 0 }, { usageEventsDisplay: [] }]) {
    assert.deepEqual(parseUsagePage(body, 0, 10_000), { total: 0, events: [] });
    const events = await fetchCursorHistory("fixture", 10_000, async () => Response.json(body));
    const result = aggregateEvents(events, 10_000);
    assert.equal(result.days.length, 1);
    assert.equal(result.days[0]?.totalTokens, 0);
  }
  for (const body of [null, [], { error: "expired" }, { totalUsageEventsCount: "bad" },
    { usageEventsDisplay: null }, { usageEventsDisplay: [event("1000", "gpt-5", 1)] }]) {
    assert.throws(() => parseUsagePage(body, 0, 10_000));
  }
  await assert.rejects(fetchCursorHistory("fixture", 10_000,
    async () => Response.json({ totalUsageEventsCount: 1 })), /incomplete pagination/);
});

test("历史总数恰好一整页时，末页省略空数组仍完成对账", async () => {
  let calls = 0;
  const rows = Array.from({ length: 1_000 }, (_, i) => event(String(i + 1), "gpt-5", 1));
  const events = await fetchCursorHistory("fixture", 10_000, async () => {
    calls++;
    return Response.json(calls === 1
      ? { totalUsageEventsCount: 1_000, usageEventsDisplay: rows }
      : { totalUsageEventsCount: 1_000 });
  });
  assert.equal(calls, 2);
  assert.equal(events.length, 1_000);
});

test("sessionFromAccessToken 用 sub 里的 user id 拼 dashboard 的会话 cookie", () => {
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
  assert.equal(aggregated.days[0]?.costComplete, true);
  assert.equal(aggregated.days[0]?.apiEquivalentCostUSD, 3);
  assert.equal(aggregated.days[0]?.models[0]?.model, "claude-4.5-sonnet-thinking");
});

test("云端没再返回的旧活动日留在账本里：仍是 ok，缺口进 warning", () => {
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
    0,
  );
  assert.equal(applied.usage.days?.find((day) => day.date === "2026-08-01")?.totalTokens, 5);
  assert.equal(applied.usage.state, "ok");
  assert.equal(applied.usage.error, null);
  assert.match(applied.usage.warning ?? "", /Kept 1/);
});

test("估价别名和长上下文门槛按快照算", () => {
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

test("快照之后补的 grok-4.7 按 xAI 公开价，档位后缀与 fast 都归到基础型号", () => {
  const at = Date.parse("2026-09-23T12:00:00Z");
  // 10 万输入 + 10 万缓存读，prompt 正好 20 万，还在基础档：$2 / $6 / $0.5 每百万
  const base = estimateCursorCost("grok-4.7", 100_000, 100_000, 100_000, 0, at);
  assert.ok(base != null && Math.abs(base - (0.2 + 0.6 + 0.05)) < 1e-9);
  for (const model of ["grok-4.7-high", "grok-4.7-xhigh-fast", "grok-4.7-medium-fast"]) {
    assert.equal(
      estimateCursorCost(model, 1_000, 2_000, 3_000, 0, at),
      estimateCursorCost("grok-4.7", 1_000, 2_000, 3_000, 0, at),
    );
  }
  // 超过 20 万 prompt 走长上下文档
  assert.equal(estimateCursorCost("grok-4.7", 250_000, 0, 0, 0, at), 1);
  assert.notEqual(estimateCursorCost("muse-spark-1.3-max", 1_000, 1_000, 0, 0, at), null);
  assert.notEqual(estimateCursorCost("kimi-k3-max", 1_000, 1_000, 0, 0, at), null);
  assert.equal(estimateCursorCost("composer-2.5-fast", 1_000, 0, 0, 0, at), null);
  assert.equal(estimateCursorCost("grok-bot-default", 1_000, 0, 0, 0, at), null);
});

const ledgerDay = (date: string, tokens: number, extra: Record<string, unknown> = {}) => ({
  date,
  inputTokens: tokens,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  totalTokens: tokens,
  apiEquivalentCostUSD: tokens / 100,
  costComplete: true,
  models: tokens > 0 ? [{ model: "gpt-5", tokens }] : [],
  ...extra,
});

test("增量那一轮整天替换拉到的两天（不是累加），其余日子和上次全量的结论原样沿用", () => {
  const full = applyLedger(
    null,
    "same",
    [ledgerDay("2026-08-01", 5), ledgerDay("2026-09-22", 7)],
    "2026-09-22T12:00:00.000Z",
    3,
  );
  assert.equal(full.ledger.fullAt, "2026-09-22T12:00:00.000Z");
  assert.deepEqual(full.ledger.fullProblems, ["3 historical requests had no token counts"]);
  const next = applyIncrementalLedger(
    full.ledger,
    [ledgerDay("2026-09-22", 9), ledgerDay("2026-09-23", 4)],
    "2026-09-23T01:00:00.000Z",
  );
  assert.deepEqual(
    next.usage.days?.map((row) => [row.date, row.totalTokens, row.apiEquivalentCostUSD]),
    [["2026-08-01", 5, 0.05], ["2026-09-22", 9, 0.09], ["2026-09-23", 4, 0.04]],
  );
  assert.equal(next.ledger.fullAt, "2026-09-22T12:00:00.000Z");
  // 拉到了就是 ok：没有 token 数的那部分是提醒，不是失败
  assert.equal(next.usage.state, "ok");
  assert.equal(next.usage.error, null);
  assert.equal(next.usage.warning, "3 historical requests had no token counts");
  assert.equal(next.usage.collectedAt, Date.parse("2026-09-23T01:00:00.000Z"));
});

test("整份账本发成契约的 agent 行：时刻是毫秒，日行补 reasoning 为 0，没有会话数", () => {
  const applied = applyLedger(
    null,
    "same",
    [
      ledgerDay("2026-09-23", 4, { costComplete: false, outputTokens: 2, totalTokens: 6, cacheReadTokens: 0 }),
      ledgerDay("2026-09-22", 7),
    ],
    "2026-09-23T01:00:00.000Z",
    0,
  );
  assert.deepEqual(applied.usage, {
    id: "cursor",
    state: "ok",
    collectedAt: Date.parse("2026-09-23T01:00:00.000Z"),
    error: null,
    warning: null,
    sessionCount: null,
    days: [
      {
        date: "2026-09-22",
        inputTokens: 7,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        reasoningTokens: 0,
        totalTokens: 7,
        apiEquivalentCostUSD: 0.07,
        costComplete: true,
        models: [{ model: "gpt-5", tokens: 7 }],
      },
      {
        date: "2026-09-23",
        inputTokens: 4,
        outputTokens: 2,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        reasoningTokens: 0,
        totalTokens: 6,
        apiEquivalentCostUSD: 0.04,
        // 费用是否完整按天：这一天有请求没估到价，不牵连别的日子
        costComplete: false,
        models: [{ model: "gpt-5", tokens: 4 }],
      },
    ],
  });
});

test("旧账本里的日子没有 reasoning 列，发出去时照样补 0，账本里多出来的字段不外泄", () => {
  const legacy = { ...ledgerDay("2026-08-01", 5), note: "旧账本自己的字段" };
  const applied = applyLedger(
    { version: 1, accountHash: "same", collectedAt: "2026-09-01T00:00:00.000Z", days: { "2026-08-01": legacy } },
    "same",
    [ledgerDay("2026-09-05", 2)],
    "2026-09-05T04:00:00.000Z",
    0,
  );
  const kept = applied.usage.days?.find((day) => day.date === "2026-08-01");
  assert.equal(kept?.reasoningTokens, 0);
  assert.equal("note" in (kept ?? {}), false);
});

test("当天没有事件也发一行空的：有行全 0 = 确认那天没用，没有行才是未知", () => {
  const now = Date.parse("2026-09-29T02:00:00Z");
  const aggregated = aggregateEvents([], now);
  assert.deepEqual(aggregated.days, [
    {
      date: "2026-09-29",
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: 0,
      apiEquivalentCostUSD: 0,
      costComplete: true,
      models: [],
    },
  ]);
  const applied = applyLedger(null, "same", aggregated.days, new Date(now).toISOString(), aggregated.unmeasured);
  assert.deepEqual(applied.usage.days?.map((day) => [day.date, day.totalTokens, day.reasoningTokens]), [["2026-09-29", 0, 0]]);
});

test("没有 token 数的请求不进模型排名，但让那一天的费用不完整", () => {
  const stamp = Date.parse("2026-09-04T04:00:00Z");
  const parsed = parseUsagePage(
    {
      totalUsageEventsCount: 2,
      usageEventsDisplay: [
        { timestamp: String(stamp), model: "composer-2", isTokenBasedCall: false },
        event(String(stamp + 1_000), "gpt-5", 10),
      ],
    },
    0,
    stamp + 60_000,
  );
  const aggregated = aggregateEvents(parsed.events, stamp);
  assert.equal(aggregated.unmeasured, 1);
  assert.equal(aggregated.days[0]?.costComplete, false);
  assert.deepEqual(aggregated.days[0]?.models, [{ model: "gpt-5", tokens: 10 }]);
});

test("拉历史仍然严格：一条缺 token 分列的事件让整页判坏，账本不收", () => {
  assert.throws(
    () =>
      parseUsagePage(
        {
          totalUsageEventsCount: 2,
          usageEventsDisplay: [event("1000", "gpt-5", 1), { timestamp: "2000", model: "github_bugbot" }],
        },
        0,
        10_000,
      ),
    /missing token usage/,
  );
});

test("这一轮拉失败只换状态：不带 days，collectedAt 是账本里最近一次成功的时刻，没有账本为 null", () => {
  const failed = failedUsage(new Error("Cursor session expired"), "2026-09-29T01:00:00.000Z");
  assert.deepEqual(failed, {
    id: "cursor",
    state: "error",
    collectedAt: Date.parse("2026-09-29T01:00:00.000Z"),
    error: "Cursor session expired",
    warning: null,
    sessionCount: null,
  });
  assert.equal("days" in failed, false);
  assert.equal(failedUsage("boom", null).collectedAt, null);
  assert.equal(failedUsage("boom", "").collectedAt, null);
  assert.equal(failedUsage("boom", null).error, "boom");
});

test("增量从上海时间昨天 0 点开始拉", () => {
  // 上海 9/23 00:30 → 从 9/22 00:00（上海）起
  assert.equal(incrementalSince(Date.parse("2026-09-22T16:30:00Z")), Date.parse("2026-09-21T16:00:00Z"));
});

/** 按 Cursor 接口的形状造一条事件，再走真正的解析（缓存写入在接口里叫 cacheWriteTokens） */
function eventRow(
  timestampMs: number,
  model: string,
  tokens: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number } | null,
) {
  return {
    timestamp: String(timestampMs),
    model,
    ...(tokens
      ? {
          tokenUsage: {
            inputTokens: tokens.input ?? 0,
            outputTokens: tokens.output ?? 0,
            cacheReadTokens: tokens.cacheRead ?? 0,
            cacheWriteTokens: tokens.cacheWrite ?? 0,
          },
          isTokenBasedCall: true,
        }
      : { isTokenBasedCall: false }),
  };
}

function parsedEvents(rows: ReturnType<typeof eventRow>[]) {
  return parseUsagePage({ totalUsageEventsCount: rows.length, usageEventsDisplay: rows }, 0, Number.MAX_SAFE_INTEGER).events;
}

const T0 = Date.parse("2026-09-29T04:00:00Z");

test("桶按事件时刻落 5 分钟：差 1 毫秒跨过边界就是两个桶", () => {
  const windows = aggregateBuckets(
    parsedEvents([
      eventRow(T0 + CODING_BUCKET_MS - 1, "gpt-5", { input: 10 }),
      eventRow(T0 + CODING_BUCKET_MS, "gpt-5", { input: 20 }),
    ]),
    T0,
    T0 + 2 * CODING_BUCKET_MS,
  );
  assert.deepEqual(
    windows.map((window) => [window.from, window.agents.map((row) => [row.inputTokens, row.eventCount])]),
    [
      [T0, [[10, 1]]],
      [T0 + CODING_BUCKET_MS, [[20, 1]]],
    ],
  );
});

test("桶只收 [from, to) 里的事件，按桶起点升序，空桶不出", () => {
  const from = T0;
  const to = T0 + 3 * CODING_BUCKET_MS;
  const windows = aggregateBuckets(
    parsedEvents([
      eventRow(to, "late", { input: 1 }),
      eventRow(to - 1, "last", { input: 2 }),
      eventRow(from, "first", { input: 3 }),
      eventRow(from - 1, "early", { input: 4 }),
    ]),
    from,
    to,
  );
  assert.deepEqual(
    windows.map((window) => [window.from, window.agents.map((row) => row.model)]),
    [
      [from, ["first"]],
      // 中间的桶没有事件，不出
      [to - CODING_BUCKET_MS, ["last"]],
    ],
  );
});

test("同一个桶里同一模型的事件相加、事件数累计；不同模型分行、按名字排；reasoning 恒为 0", () => {
  const [window] = aggregateBuckets(
    parsedEvents([
      eventRow(T0 + 1_000, "gpt-5", { input: 10, output: 1, cacheRead: 100, cacheWrite: 5 }),
      eventRow(T0 + 2_000, "claude-sonnet-4-5", { input: 7 }),
      eventRow(T0 + 3_000, "gpt-5", { input: 20, output: 2, cacheRead: 200, cacheWrite: 6 }),
    ]),
    T0,
    T0 + CODING_BUCKET_MS,
  );
  assert.deepEqual(window?.agents, [
    {
      id: "cursor",
      model: "claude-sonnet-4-5",
      inputTokens: 7,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      reasoningTokens: 0,
      eventCount: 1,
    },
    {
      id: "cursor",
      model: "gpt-5",
      inputTokens: 30,
      outputTokens: 3,
      cacheReadTokens: 300,
      cacheCreationTokens: 11,
      reasoningTokens: 0,
      eventCount: 2,
    },
  ]);
});

test("不按 token 计费的请求也算一条事件，token 记 0", () => {
  const [window] = aggregateBuckets(parsedEvents([eventRow(T0 + 1_000, "composer-2", null)]), T0, T0 + CODING_BUCKET_MS);
  assert.deepEqual(window?.agents.map((row) => [row.model, row.inputTokens + row.outputTokens, row.eventCount]), [
    ["composer-2", 0, 1],
  ]);
});

test("桶报告：范围原样带上，没有事件是空 windows，有解析不了的事件就标 partial", () => {
  const events = parsedEvents([eventRow(T0 + 1_000, "gpt-5", { input: 10 })]);
  const range = { from: T0, to: T0 + CODING_BUCKET_MS };
  const ok = cursorBucketReport(events, range, T0 + 120_000);
  assert.deepEqual(
    { ...ok, windows: ok.windows.length },
    { from: T0, to: T0 + CODING_BUCKET_MS, collectedAt: T0 + 120_000, agents: [{ id: "cursor", state: "ok" }], windows: 1 },
  );
  assert.deepEqual(cursorBucketReport([], range, T0 + 120_000).windows, []);
  assert.deepEqual(cursorBucketReport(events, range, T0 + 120_000, true).agents, [{ id: "cursor", state: "partial" }]);
});

test("桶起点对齐到 5 分钟的整数倍", () => {
  assert.equal(bucketStart(T0), T0);
  assert.equal(bucketStart(T0 + CODING_BUCKET_MS - 1), T0);
  assert.equal(bucketStart(T0 + CODING_BUCKET_MS), T0 + CODING_BUCKET_MS);
  assert.equal(bucketStart(T0 - 1), T0 - CODING_BUCKET_MS);
});

test("活动取最新一条：时刻相同先到的赢，没有事件就是 null，晚于采集时刻的按采集时刻算", () => {
  assert.deepEqual(latestOf([{ at: 5, model: "a" }, { at: 9, model: "b" }, { at: 9, model: "c" }, { at: null, model: "x" }]), {
    at: 9,
    model: "b",
  });
  assert.equal(latestOf([]), null);
  assert.deepEqual(cursorActivityReport(T0, { at: T0 - 1_000, model: "gpt-5" }), {
    collectedAt: T0,
    agents: [{ id: "cursor", lastActivityAt: T0 - 1_000, model: "gpt-5" }],
  });
  assert.deepEqual(cursorActivityReport(T0, null).agents, [{ id: "cursor", lastActivityAt: null, model: null }]);
  assert.equal(cursorActivityReport(T0, { at: T0 + 200_000, model: null }).agents[0]?.lastActivityAt, T0);
});

/**
 * 造 count 个不同模型、各一条事件，用量各不相同（第 0 个最多、往后递减，排名才确定）。
 * 事件都落在同一个站点日、同一个 5 分钟桶（T0 起每秒一条）。
 */
function crowdedEvents(count: number, nameOf = (index: number) => `model-${String(index).padStart(3, "0")}`) {
  return parsedEvents(
    Array.from({ length: count }, (_, index) =>
      eventRow(T0 + index * 1_000, nameOf(index), { input: 10_000 - index * 10, output: 2, cacheRead: 30, cacheWrite: 4 }),
    ),
  );
}

const tokensOf = (item: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheCreationTokens: number }) =>
  item.inputTokens + item.outputTokens + item.cacheReadTokens + item.cacheCreationTokens;
const sumOf = <Item,>(items: Item[], pick: (item: Item) => number) => items.reduce((sum, item) => sum + pick(item), 0);

test("一天 41 个模型：全部留名，模型合计等于总量（曾经在 40 个上截断，被截的量悄悄从排名里少掉）", () => {
  const events = crowdedEvents(41);
  const day = aggregateEvents(events, T0).days.find((row) => row.totalTokens > 0);
  assert.equal(day?.models.length, 41);
  assert.ok(day?.models.some((row) => row.model === "model-040"));
  assert.equal(sumOf(day?.models ?? [], (row) => row.tokens), day?.totalTokens);
  assert.equal(sumOf(events, tokensOf), day?.totalTokens);
});

test("一天恰好 MAX_DAY_MODELS 个模型：原样留名，不并", () => {
  const day = aggregateEvents(crowdedEvents(MAX_DAY_MODELS), T0).days.find((row) => row.totalTokens > 0);
  assert.equal(day?.models.length, MAX_DAY_MODELS);
  assert.ok(day?.models.every((row) => row.model !== OVERFLOW_MODEL));
  assert.equal(sumOf(day?.models ?? [], (row) => row.tokens), day?.totalTokens);
});

test("一天模型超过 MAX_DAY_MODELS：用量大的 MAX_DAY_MODELS - 1 个留名，其余并成 OVERFLOW_MODEL 一行，合计不变", () => {
  const events = crowdedEvents(MAX_DAY_MODELS + 6);
  const day = aggregateEvents(events, T0).days.find((row) => row.totalTokens > 0);
  const ranked = events.map((item) => [item.model, tokensOf(item)] as const).sort((left, right) => right[1] - left[1]);
  assert.equal(day?.models.length, MAX_DAY_MODELS);
  assert.deepEqual(
    day?.models.filter((row) => row.model !== OVERFLOW_MODEL).map((row) => [row.model, row.tokens]),
    ranked.slice(0, MAX_DAY_MODELS - 1),
  );
  assert.deepEqual(day?.models.find((row) => row.model === OVERFLOW_MODEL), {
    model: OVERFLOW_MODEL,
    tokens: sumOf(ranked.slice(MAX_DAY_MODELS - 1), ([, tokens]) => tokens),
  });
  assert.equal(sumOf(day?.models ?? [], (row) => row.tokens), day?.totalTokens);
  // 并出来的一行是好几个小行之和，可能比留名的大：折完要重排，仍是用量降序、同量按名字
  assert.deepEqual(
    day?.models,
    [...(day?.models ?? [])].sort((left, right) => right.tokens - left.tokens || (left.model < right.model ? -1 : 1)),
  );
});

test("真有模型叫 OVERFLOW_MODEL：并进那一行，同一天的行名不重复", () => {
  // 0 = 用量最大的就叫这个名字（留名的那一行接住其余）；最后一个 = 用量最小的（落在被并的那一段里）
  for (const at of [0, MAX_DAY_MODELS + 5]) {
    const events = crowdedEvents(MAX_DAY_MODELS + 6, (index) => (index === at ? OVERFLOW_MODEL : `model-${index}`));
    const day = aggregateEvents(events, T0).days.find((row) => row.totalTokens > 0);
    const names = day?.models.map((row) => row.model) ?? [];
    assert.equal(new Set(names).size, names.length, `第 ${at} 个模型叫 ${OVERFLOW_MODEL}`);
    assert.equal(sumOf(day?.models ?? [], (row) => row.tokens), day?.totalTokens, `第 ${at} 个模型叫 ${OVERFLOW_MODEL}`);
  }
});

test("一个窗口恰好 MAX_WINDOW_ROWS 个模型：原样留名，不并", () => {
  const [window] = aggregateBuckets(crowdedEvents(MAX_WINDOW_ROWS), T0, T0 + CODING_BUCKET_MS);
  assert.equal(window?.agents.length, MAX_WINDOW_ROWS);
  assert.ok(window?.agents.every((row) => row.model !== OVERFLOW_MODEL));
});

test("一个窗口模型超过 MAX_WINDOW_ROWS：用量大的留名，其余并成 OVERFLOW_MODEL 一行，各列和事件数都不变，别的窗口不动", () => {
  const events = [
    ...crowdedEvents(MAX_WINDOW_ROWS + 1),
    ...parsedEvents([
      eventRow(T0 + CODING_BUCKET_MS + 1_000, "gpt-5", { input: 5 }),
      eventRow(T0 + CODING_BUCKET_MS + 2_000, "composer-2", null),
    ]),
  ];
  const windows = aggregateBuckets(events, T0, T0 + 2 * CODING_BUCKET_MS);
  assert.equal(windows.length, 2);

  const [crowded, quiet] = windows;
  const inCrowded = events.filter((item) => item.timestampMs < T0 + CODING_BUCKET_MS);
  assert.equal(crowded?.agents.length, MAX_WINDOW_ROWS);
  for (const column of ["inputTokens", "outputTokens", "cacheReadTokens", "cacheCreationTokens"] as const) {
    assert.equal(
      sumOf(crowded?.agents ?? [], (row) => row[column]),
      sumOf(inCrowded, (item) => item[column]),
      column,
    );
  }
  assert.equal(sumOf(crowded?.agents ?? [], (row) => row.eventCount), inCrowded.length);

  // 留名的是 token 最多的 MAX_WINDOW_ROWS - 1 个（最小的两个并进 OVERFLOW_MODEL），行仍按模型名排
  const named = crowded?.agents.filter((row) => row.model !== OVERFLOW_MODEL) ?? [];
  assert.deepEqual(
    named.map((row) => row.model),
    Array.from({ length: MAX_WINDOW_ROWS - 1 }, (_, index) => `model-${String(index).padStart(3, "0")}`),
  );
  const overflow = crowded?.agents.find((row) => row.model === OVERFLOW_MODEL);
  assert.equal(overflow?.eventCount, 2);
  assert.equal(overflow?.inputTokens, 10_000 - (MAX_WINDOW_ROWS - 1) * 10 + (10_000 - MAX_WINDOW_ROWS * 10));
  assert.deepEqual(
    crowded?.agents.map((row) => row.model),
    [...(crowded?.agents ?? [])].map((row) => row.model).sort(),
  );

  assert.deepEqual(quiet?.agents.map((row) => [row.model, row.eventCount]), [["composer-2", 1], ["gpt-5", 1]]);
});

test("窗口里真有模型叫 OVERFLOW_MODEL：并进那一行，同一窗口的行名不重复", () => {
  for (const at of [0, MAX_WINDOW_ROWS]) {
    const events = crowdedEvents(MAX_WINDOW_ROWS + 1, (index) => (index === at ? OVERFLOW_MODEL : `model-${index}`));
    const [window] = aggregateBuckets(events, T0, T0 + CODING_BUCKET_MS);
    const names = window?.agents.map((row) => row.model) ?? [];
    assert.equal(new Set(names).size, names.length, `第 ${at} 个模型叫 ${OVERFLOW_MODEL}`);
    assert.equal(sumOf(window?.agents ?? [], (row) => row.eventCount), events.length, `第 ${at} 个模型叫 ${OVERFLOW_MODEL}`);
  }
});
