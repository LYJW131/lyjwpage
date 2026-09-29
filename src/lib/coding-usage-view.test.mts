import assert from "node:assert/strict";
import test from "node:test";

import type { CodingUsageDay } from "@shared/coding-usage";
import {
  applyCodingUsageStatus,
  buildCodingNowAgents,
  buildCodingUsageView,
  CODING_YEAR_KEEP_DAYS,
  type StoredCodingUsage,
  type StoredCodingUsageAgent,
} from "@shared/coding-usage-view";

/** 2026-09-29 12:00 Asia/Shanghai */
const NOW = Date.parse("2026-09-29T04:00:00Z");

function day(date: string, totalTokens: number, models: Array<[string, number]> = [], extra: Partial<CodingUsageDay> = {}): CodingUsageDay {
  return {
    date,
    inputTokens: totalTokens,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    reasoningTokens: 0,
    totalTokens,
    apiEquivalentCostUSD: totalTokens / 1_000,
    costComplete: true,
    models: models.map(([model, tokens]) => ({ model, tokens })),
    ...extra,
  };
}

function ledger(id: string, days: CodingUsageDay[], extra: Partial<StoredCodingUsageAgent> = {}): StoredCodingUsageAgent {
  return { id, state: "ok", collectedAt: NOW - 60_000, error: null, warning: null, sessionCount: null, days, receivedAt: NOW - 60_000, ...extra };
}

const build = (stored: StoredCodingUsage) => buildCodingUsageView(stored, NOW);

test("只有一个来源：合计、最近一天、模型名单都是它的", () => {
  const { view } = build({ mac: { codex: ledger("codex", [
    day("2026-09-27", 100, [["gpt-5.5", 60], ["gpt-6", 40]]),
    day("2026-09-28", 50, [["gpt-6", 50]]),
  ], { sessionCount: 4 }) } });
  assert.equal(view.updatedAt, NOW);
  assert.deepEqual(view.totals, {
    inputTokens: 150, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0, totalTokens: 150,
    apiEquivalentCostUSD: 0.15, costComplete: true, activeDays: 2, sessionCount: 4,
  });
  assert.deepEqual(view.topModels, [{ model: "gpt-6", tokens: 90 }, { model: "gpt-5.5", tokens: 60 }]);
  const [codex] = view.agents;
  assert.deepEqual(codex.sources, ["mac"]);
  assert.deepEqual(codex.models, ["gpt-6", "gpt-5.5"]);
  assert.equal(codex.latestModel, "gpt-6");
  assert.equal(codex.lastDay?.date, "2026-09-28");
  assert.equal(codex.lastDay?.totalTokens, 50);
  assert.deepEqual(codex.status, [{ source: "mac", state: "ok", collectedAt: NOW - 60_000, error: null, warning: null }]);
});

test("设备级与环境级来源相加：claude 的本机与云端同一天合起来，会话数相加", () => {
  const { view } = build({
    mac: { claude: ledger("claude", [day("2026-09-28", 100, [["claude-opus-5", 100]]), day("2026-09-29", 10, [["claude-opus-5", 10]])], { sessionCount: 7 }) },
    "agents-otlp": { claude: ledger("claude", [day("2026-09-29", 30, [["claude-fable-5", 30]])], { sessionCount: 2 }) },
  });
  const [claude] = view.agents;
  assert.deepEqual(claude.sources, ["mac", "agents-otlp"]);
  assert.equal(claude.lastDay?.date, "2026-09-29");
  assert.equal(claude.lastDay?.totalTokens, 40);
  assert.equal(claude.latestModel, "claude-fable-5", "最近一天里 token 最多的模型");
  assert.equal(view.totals?.totalTokens, 140);
  assert.equal(view.totals?.sessionCount, 9);
});

test("有账号级来源就只算它：Mac 报来的 cursor 标 superseded，哪里都不算", () => {
  const { view, year } = build({
    mac: {
      cursor: ledger("cursor", [day("2026-09-29", 9_999, [["composer-1", 9_999]])], { sessionCount: 50 }),
      codex: ledger("codex", [day("2026-09-29", 1)]),
    },
    agents: { cursor: ledger("cursor", [day("2026-09-29", 20, [["composer-2", 20]])], { collectedAt: NOW - 1_000 }) },
  });
  const cursor = view.agents.find((agent) => agent.id === "cursor")!;
  assert.deepEqual(cursor.sources, ["agents"]);
  assert.deepEqual(cursor.status.map((row) => [row.source, row.state]), [["mac", "superseded"], ["agents", "ok"]]);
  assert.equal(cursor.lastDay?.totalTokens, 20);
  assert.deepEqual(cursor.models, ["composer-2"]);
  assert.equal(view.totals?.totalTokens, 21);
  assert.equal(view.totals?.sessionCount, null, "superseded 的会话数不算，剩下的来源都数不出会话");
  assert.equal(year.days["2026-09-29"]?.tokens, 21);
});

test("前三模型在完整数据上精确累加，不在每个来源截断过的前三上相加", () => {
  // 每个来源自己的前三里都没有 d，合起来它是第二
  const { view } = build({
    mac: { claude: ledger("claude", [day("2026-09-28", 100, [["a", 40], ["b", 30], ["c", 20], ["d", 10]])]) },
    "agents-otlp": { claude: ledger("claude", [day("2026-09-28", 100, [["e", 40], ["f", 30], ["g", 20], ["d", 10]])]) },
    agents: { cursor: ledger("cursor", [day("2026-09-28", 45, [["d", 25], ["h", 20]])]) },
  });
  assert.deepEqual(view.topModels, [{ model: "d", tokens: 45 }, { model: "a", tokens: 40 }, { model: "e", tokens: 40 }]);
});

test("活跃天数是全部历史、全部 agent 的站点日并集；全 0 的行是确认没用，不算", () => {
  const { view } = build({
    mac: {
      claude: ledger("claude", [day("2024-01-01", 5), day("2026-09-28", 5), day("2026-09-29", 0)]),
      codex: ledger("codex", [day("2026-09-28", 5), day("2025-06-01", 7)]),
    },
    agents: { cursor: ledger("cursor", [day("2023-03-03", 1)]) },
  });
  assert.equal(view.totals?.activeDays, 4);
  // 最近一个有行的日子是确认过的 0：今天用了 0，不是未知
  assert.deepEqual(view.agents.find((agent) => agent.id === "claude")?.lastDay, {
    date: "2026-09-29", inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, totalTokens: 0,
    apiEquivalentCostUSD: 0, costComplete: true,
  });
});

test("costComplete 按天：有 token 的一天没估全就是 false；没有 token 的行不拉低，来源失败也不拉低", () => {
  const complete = build({ mac: {
    claude: ledger("claude", [day("2026-09-28", 10), day("2026-09-29", 0, [], { costComplete: false })]),
    grok: ledger("grok", [day("2026-09-20", 3)], { state: "error", error: "ccusage timed out" }),
  } });
  assert.equal(complete.view.totals?.costComplete, true);
  assert.equal(complete.view.agents.find((agent) => agent.id === "grok")?.status[0]?.state, "error");
  assert.equal(complete.view.totals?.totalTokens, 13, "失败那一轮保留的旧日子照样算");

  const partial = build({ mac: { claude: ledger("claude", [day("2026-09-28", 10, [], { costComplete: false }), day("2026-09-29", 5)]) } });
  assert.equal(partial.view.totals?.costComplete, false);
  assert.equal(partial.view.agents[0]?.lastDay?.costComplete, true, "最近那一天自己估全了");
});

test("占位模型名不进排名、不当模型名、不进年度拆分", () => {
  const { view, year } = build({ mac: { claude: ledger("claude", [
    day("2026-09-28", 100, [["<synthetic>", 50], ["unknown", 30], ["claude-opus-5", 20]]),
    day("2026-09-29", 10, [["", 10]]),
  ]) } });
  assert.deepEqual(view.topModels, [{ model: "claude-opus-5", tokens: 20 }]);
  assert.deepEqual(view.agents[0]?.models, ["claude-opus-5"]);
  assert.equal(view.agents[0]?.latestModel, "claude-opus-5", "最近一天只有占位名时往前找");
  assert.deepEqual(year.days["2026-09-28"]?.models, [["claude-opus-5", 20]]);
});

test("年度视图只留最近 380 天里有用量的日子，每天精确的前五", () => {
  const models: Array<[string, number]> = [["a", 6], ["b", 5], ["c", 4], ["d", 3], ["e", 2], ["f", 1]];
  const oldest = new Date(NOW + 8 * 3_600_000 - (CODING_YEAR_KEEP_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
  const tooOld = new Date(NOW + 8 * 3_600_000 - CODING_YEAR_KEEP_DAYS * 86_400_000).toISOString().slice(0, 10);
  const { year } = build({
    mac: { claude: ledger("claude", [day(tooOld, 9), day(oldest, 8), day("2026-09-28", 21, models), day("2026-09-29", 0)]) },
    agents: { cursor: ledger("cursor", [day("2026-09-28", 7, [["f", 7]])]) },
  });
  assert.deepEqual(Object.keys(year.days), [oldest, "2026-09-28"]);
  assert.deepEqual(year.days["2026-09-28"], { tokens: 28, models: [["f", 8], ["a", 6], ["b", 5], ["c", 4], ["d", 3]] });
  assert.equal(year.updatedAt, NOW);
});

test("一个账本都没有：合计是 null，不是 0", () => {
  const { view, year } = build({});
  assert.deepEqual(view, { updatedAt: NOW, totals: null, topModels: [], agents: [] });
  assert.deepEqual(year.days, {});
});

test("此刻：各来源的最近事件按 agent 并起来、时刻降序；从没见过的不列，占位模型名换成 null", () => {
  assert.deepEqual(buildCodingNowAgents({
    mac: { agents: [
      { id: "claude", lastActivityAt: NOW - 120_000, model: "claude-opus-5" },
      { id: "grok", lastActivityAt: null, model: null },
    ] },
    "agents-otlp": { agents: [{ id: "claude", lastActivityAt: NOW - 30_000, model: "<synthetic>" }] },
    agents: { agents: [{ id: "cursor", lastActivityAt: NOW - 1_000, model: "composer-2" }] },
  }), [
    { id: "claude", activity: [
      { source: "agents-otlp", lastActivityAt: NOW - 30_000, model: null },
      { source: "mac", lastActivityAt: NOW - 120_000, model: "claude-opus-5" },
    ] },
    { id: "cursor", activity: [{ source: "agents", lastActivityAt: NOW - 1_000, model: "composer-2" }] },
  ]);
  assert.deepEqual(buildCodingNowAgents({ mac: null }), []);
});

test("只换状态：在存着的视图上改那几格，结果和整份重算一样；superseded 照旧，对不上就返回 null", () => {
  const before: StoredCodingUsage = {
    mac: {
      claude: ledger("claude", [day("2026-09-28", 100, [["claude-opus-5", 100]])], { sessionCount: 2 }),
      cursor: ledger("cursor", [day("2026-09-28", 5, [["composer-2", 5]])]),
    },
    agents: { cursor: ledger("cursor", [day("2026-09-28", 40, [["composer-2", 40]])]) },
  };
  const { view } = build(before);
  const failed = { ...before.mac!.claude!, state: "error" as const, collectedAt: NOW - 30_000, error: "ccusage timed out" };
  const cursorLater = { ...before.mac!.cursor!, collectedAt: NOW - 10_000 };
  const patched = applyCodingUsageStatus(view, "mac", { claude: failed, cursor: cursorLater });
  const rebuilt = build({ ...before, mac: { claude: failed, cursor: cursorLater } }).view;
  assert.deepEqual(patched, rebuilt);
  const cursorMac = patched?.agents.find((agent) => agent.id === "cursor")?.status.find((row) => row.source === "mac");
  assert.equal(cursorMac?.state, "superseded", "the account source still wins");
  assert.equal(cursorMac?.collectedAt, NOW - 10_000);
  assert.equal(applyCodingUsageStatus(view, "agents-otlp", { claude: failed }), null, "no such row: the caller rebuilds");
});
