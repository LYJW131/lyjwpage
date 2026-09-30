import assert from "node:assert/strict";
import test from "node:test";

const token = `aaa.${Buffer.from(JSON.stringify({ sub: "auth0|user_fixture" })).toString("base64url")}.bbb`;
process.env.CURSOR_AUTH_TOKEN = token;

const { CODING_BUCKET_MS, bucketStart } = await import("../dist/coding-usage.js");
const { fetchCursorRecent, nextActivityInterval, recentReports } = await import("../dist/cursor-now.js");
const { parseRecentPage } = await import("../dist/cursor-usage.js");

const NOW = Date.parse("2026-09-29T04:12:30Z");
const FROM = bucketStart(NOW - 15 * 60_000);

function row(offsetMs: number, model: string, tokens = 1) {
  return {
    timestamp: String(NOW + offsetMs),
    model,
    tokenUsage: { inputTokens: tokens, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    isTokenBasedCall: true,
  };
}

const oddRow = (offsetMs: number, model = "github_bugbot") => ({ timestamp: String(NOW + offsetMs), model });

function recent(rows: unknown[], total = rows.length) {
  const parsed = parseRecentPage({ totalUsageEventsCount: total, usageEventsDisplay: rows }, FROM, NOW + 5 * 60_000);
  return recentReports(parsed.events, FROM, NOW);
}

test("宽松解析逐行判：token 分列缺项的事件只丢它自己，时刻还认得的照样算活动", () => {
  const page = parseRecentPage(
    {
      totalUsageEventsCount: 6,
      usageEventsDisplay: [
        row(-60_000, "gpt-5"),
        oddRow(-30_000),
        { timestamp: "junk", model: "bad-time" },
        { timestamp: String(FROM - 1), model: "too-early" },
        { ...row(-20_000, "bad-count"), tokenUsage: { inputTokens: "many" } },
        { timestamp: String(NOW - 10_000) },
      ],
    },
    FROM,
    NOW + 5 * 60_000,
  );
  assert.equal(page.total, 6);
  assert.deepEqual(
    page.events.map((entry) => [entry.at == null ? null : entry.at - NOW, entry.model, entry.event != null]),
    [
      [-60_000, "gpt-5", true],
      [-30_000, "github_bugbot", false],
      [null, "bad-time", false],
      [null, "too-early", false],
      [-20_000, "bad-count", false],
      [-10_000, null, false],
    ],
  );
});

test("Cursor 把空数组整个省掉时是没有事件；结构不对才报错；缺总数只在一页装得下时认", () => {
  const empty = parseRecentPage({}, FROM, NOW);
  assert.deepEqual([empty.total, empty.events.length], [0, 0]);
  assert.equal(parseRecentPage({ totalUsageEventsCount: 0 }, FROM, NOW).events.length, 0);
  assert.equal(parseRecentPage({ usageEventsDisplay: [row(-1_000, "gpt-5")] }, FROM, NOW).total, 1);
  assert.throws(() => parseRecentPage(null, FROM, NOW));
  assert.throws(() => parseRecentPage({ usageEventsDisplay: "x" }, FROM, NOW));
  const full = Array.from({ length: 1_000 }, (_, index) => row(-1_000 - index, "gpt-5"));
  assert.throws(() => parseRecentPage({ usageEventsDisplay: full }, FROM, NOW), /total/);
});

test("快循环载荷：页里混一条缺 token 分列的事件，活动和桶照出，桶报告标 partial", () => {
  const { activity, buckets, latestAt } = recent([
    row(-200_000, "gpt-5", 10),
    row(-100_000, "gpt-5", 20),
    oddRow(-40_000),
    row(-150_000, "composer-2", 5),
  ]);
  assert.equal(latestAt, NOW - 40_000);
  assert.deepEqual(activity, {
    collectedAt: NOW,
    agents: [{ id: "cursor", lastActivityAt: NOW - 40_000, model: "github_bugbot" }],
  });
  assert.deepEqual(buckets.agents, [{ id: "cursor", state: "partial" }]);
  assert.deepEqual(
    buckets.windows.map((window) => [
      new Date(window.from).toISOString(),
      window.agents.map((entry) => [entry.model, entry.inputTokens, entry.eventCount]),
    ]),
    [
      ["2026-09-29T04:05:00.000Z", [["gpt-5", 10, 1]]],
      [
        "2026-09-29T04:10:00.000Z",
        [
          ["composer-2", 5, 1],
          ["gpt-5", 20, 1],
        ],
      ],
    ],
  );
});

test("桶范围是 [向下对齐到桶边界的 now - 15 分钟, now)：首桶完整，晚于 now 的事件留给下一封", () => {
  const { buckets, activity } = recent([row(-14 * 60_000, "gpt-5", 1), row(30_000, "gpt-5", 2)]);
  assert.equal(buckets.from, FROM);
  assert.equal(buckets.from % CODING_BUCKET_MS, 0);
  assert.equal(buckets.to, NOW);
  assert.equal(buckets.collectedAt, NOW);
  assert.equal(buckets.from <= NOW - 15 * 60_000 && NOW - 15 * 60_000 - buckets.from < CODING_BUCKET_MS, true);
  assert.equal(buckets.windows.reduce((sum, window) => sum + window.agents.reduce((n, entry) => n + (entry.eventCount ?? 0), 0), 0), 1);
  assert.deepEqual(buckets.agents, [{ id: "cursor", state: "ok" }]);
  assert.equal(activity.agents[0]?.lastActivityAt, NOW);
});

test("窗口里没有事件：活动行照发（时刻为空），桶报告是空 windows、状态 ok —— 那一段确认没用", () => {
  const { activity, buckets, latestAt } = recent([]);
  assert.equal(latestAt, null);
  assert.deepEqual(activity.agents, [{ id: "cursor", lastActivityAt: null, model: null }]);
  assert.deepEqual(buckets.windows, []);
  assert.deepEqual(buckets.agents, [{ id: "cursor", state: "ok" }]);
});

test("快循环整条取数：按 [对齐的起点, now + 钟差] 分页取全，丢掉的行也数进分页对账，坏事件标 partial", async () => {
  const total = 1_003;
  const first = Array.from({ length: 1_000 }, (_, index) => row(-600_000 + index, "gpt-5", 1));
  const second = [row(-30_000, "gpt-5", 1), row(-20_000, "gpt-5", 1), oddRow(-10_000)];
  const requests: Array<{ page: number; pageSize: number; startDate: string; endDate: string }> = [];
  const fakeFetch = (async (_url: string, init: { body: string; headers: Record<string, string> }) => {
    const request = JSON.parse(init.body);
    requests.push(request);
    assert.match(init.headers.Cookie ?? "", /^WorkosCursorSessionToken=user_fixture%3A%3A/);
    const rows = request.page === 1 ? first : second;
    return new Response(JSON.stringify({ totalUsageEventsCount: total, usageEventsDisplay: rows }), { status: 200 });
  }) as unknown as typeof fetch;

  const result = await fetchCursorRecent(NOW, fakeFetch);
  assert.ok(result);
  assert.deepEqual(requests.map((request) => request.page), [1, 2]);
  assert.equal(requests[0]?.pageSize, 1_000);
  assert.equal(requests[0]?.startDate, String(FROM));
  assert.equal(requests[0]?.endDate, String(NOW + 5 * 60_000));
  assert.equal(result.latestAt, NOW - 10_000);
  assert.deepEqual(result.buckets.agents, [{ id: "cursor", state: "partial" }]);
  const events = result.buckets.windows.reduce((sum, window) => sum + window.agents.reduce((n, entry) => n + (entry.eventCount ?? 0), 0), 0);
  assert.equal(events, 1_002);
});

test("取数失败照常抛：登录过期不能当成没有事件", async () => {
  const expired = (async () => new Response("no", { status: 401 })) as unknown as typeof fetch;
  await assert.rejects(fetchCursorRecent(NOW, expired), /session expired/);
});

test("有新事件回到 1 分钟，没有就翻倍，封顶 4 分钟", () => {
  assert.equal(nextActivityInterval(60_000, false), 120_000);
  assert.equal(nextActivityInterval(120_000, false), 240_000);
  assert.equal(nextActivityInterval(240_000, false), 240_000);
  assert.equal(nextActivityInterval(240_000, true), 60_000);
});
