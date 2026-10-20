import assert from "node:assert/strict";
import test from "node:test";

import { bucketStart, CODING_BUCKET_MS, MAX_DAY_MODELS, MAX_WINDOW_ROWS, OVERFLOW_MODEL } from "../dist/coding-usage.js";
import {
  aggregateBuckets,
  aggregateEvents,
  cursorActivityReport,
  cursorBucketReport,
  latestOf,
  parseUsagePage,
} from "../dist/cursor-usage.js";

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
  assert.deepEqual(
    day?.models,
    [...(day?.models ?? [])].sort((left, right) => right.tokens - left.tokens || (left.model < right.model ? -1 : 1)),
  );
});

test("真有模型叫 OVERFLOW_MODEL：并进那一行，同一天的行名不重复", () => {
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
