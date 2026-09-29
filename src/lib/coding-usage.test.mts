import assert from "node:assert/strict";
import test from "node:test";

import { isVisibleCodingModel } from "@shared/coding-models";
import {
  CODING_BUCKET_MS,
  normalizeCodingActivityReport,
  normalizeCodingTokenBucketReport,
  normalizeCodingUsageReport,
} from "@shared/coding-usage";
import { CODING_USAGE_SOURCE_NAMES, contributingSources, isCodingUsageSource, resolveCodingUsageSources } from "@shared/coding-usage-sources";

const NOW = Date.parse("2026-09-29T04:00:00Z");
const MIN = 60_000;

function day(date: string, extra: Record<string, unknown> = {}) {
  return {
    date,
    inputTokens: 10,
    outputTokens: 20,
    cacheReadTokens: 30,
    cacheCreationTokens: 40,
    reasoningTokens: 5,
    totalTokens: 100,
    apiEquivalentCostUSD: 0.25,
    costComplete: true,
    models: [{ model: "claude-opus-5", tokens: 60 }, { model: "claude-sonnet-5", tokens: 40 }],
    ...extra,
  };
}

function agent(id: string, extra: Record<string, unknown> = {}) {
  return { id, state: "ok", collectedAt: NOW - MIN, error: null, warning: null, sessionCount: 3, days: [day("2026-09-28")], ...extra };
}

const usage = (...agents: unknown[]) => normalizeCodingUsageReport({ agents }, NOW);

/** 断言某份用量报告被拒，并且原因里带着出问题的那一处 */
function rejectsUsage(input: unknown, pattern: RegExp) {
  assert.throws(() => normalizeCodingUsageReport(input, NOW), { message: pattern });
}

test("用量：合规的报告原样收下，日子按日期排、模型按用量排，零用量的模型行丢掉", () => {
  const report = usage(agent("claude", {
    days: [
      day("2026-09-28", { models: [{ model: "b", tokens: 10 }, { model: "a", tokens: 0 }, { model: "c", tokens: 90 }] }),
      day("2026-09-27"),
    ],
  }));
  const [claude] = report.agents;
  assert.deepEqual(claude.days?.map((row) => row.date), ["2026-09-27", "2026-09-28"]);
  assert.deepEqual(claude.days?.[1]?.models, [{ model: "c", tokens: 90 }, { model: "b", tokens: 10 }]);
  assert.equal(claude.sessionCount, 3);
  assert.equal(claude.collectedAt, NOW - MIN);
});

test("用量：零与未知 —— 全 0 的行是「确认没用」，照收；可空字段缺省按 null（Swift 省掉 nil）", () => {
  const zero = day("2026-09-29", {
    inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0,
    totalTokens: 0, apiEquivalentCostUSD: 0, models: [],
  });
  const report = usage({ id: "codex", state: "ok", collectedAt: NOW, days: [zero] });
  assert.deepEqual(report.agents[0], {
    id: "codex", state: "ok", collectedAt: NOW, error: null, warning: null, sessionCount: null, days: [zero],
  });
});

test("用量：多出来的 token 是来源没分列的量，total 可以大于四列之和", () => {
  assert.equal(usage(agent("grok", { days: [day("2026-09-28", { totalTokens: 1_000 })] })).agents[0].days?.[0]?.totalTokens, 1_000);
});

test("用量：state error 只换状态 —— 不带 days；带了就拒，ok 却没带 days 或没带 collectedAt 也拒", () => {
  const failed = usage({ id: "antigravity", state: "error", collectedAt: NOW - 3_600_000, error: " ccusage 超时 " });
  assert.deepEqual(failed.agents[0], {
    id: "antigravity", state: "error", collectedAt: NOW - 3_600_000, error: "ccusage 超时", warning: null, sessionCount: null,
  });
  assert.equal("days" in failed.agents[0], false);
  // 从没成功过：collectedAt 为 null
  assert.equal(usage({ id: "pi", state: "error", collectedAt: null, error: "no logs" }).agents[0].collectedAt, null);
  rejectsUsage({ agents: [agent("pi", { state: "error" })] }, /^agents\[0\]\.days state 为 error 时必须缺省/);
  rejectsUsage({ agents: [agent("pi", { days: undefined })] }, /^agents\[0\]\.days 必须是数组/);
  rejectsUsage({ agents: [agent("pi", { collectedAt: null })] }, /^agents\[0\]\.collectedAt state 为 ok 时不能缺/);
  rejectsUsage({ agents: [agent("pi", { state: "unavailable" })] }, /^agents\[0\]\.state/);
});

test("用量：error / warning 去掉首尾空白，按码点截到 500", () => {
  const long = "错".repeat(600);
  const [row] = usage(agent("codex", { warning: long, error: "   " })).agents;
  assert.equal([...(row.warning ?? "")].length, 500);
  assert.equal(row.error, null);
  rejectsUsage({ agents: [agent("codex", { warning: 42 })] }, /^agents\[0\]\.warning 必须是字符串或 null/);
});

test("用量：id 必须是小写短名，同一封不能重复", () => {
  for (const id of ["Claude", "-claude", "claude code", "", "a".repeat(41), 42]) {
    rejectsUsage({ agents: [agent("x", { id })] }, /^agents\[0\]\.id 必须匹配/);
  }
  assert.equal(usage(agent("a".repeat(40))).agents[0].id.length, 40);
  assert.equal(usage(agent("gpt-5.5_x")).agents[0].id, "gpt-5.5_x");
  rejectsUsage({ agents: [agent("claude"), agent("codex"), agent("claude")] }, /^agents\[2\]\.id 重复/);
});

test("用量：报告本身要有 agents，至少一个、最多 64 个", () => {
  rejectsUsage(null, /^必须是对象$/);
  rejectsUsage([], /^必须是对象$/);
  rejectsUsage({}, /^agents 必须是数组/);
  rejectsUsage({ agents: [] }, /^agents 不能为空/);
  rejectsUsage({ agents: Array.from({ length: 65 }, (_, index) => agent(`a${index}`)) }, /^agents 最多 64 条/);
});

test("用量：计数必须是非负安全整数，reasoning 不能超过 output", () => {
  for (const bad of [-1, 1.5, "10", null, Number.MAX_SAFE_INTEGER + 1]) {
    rejectsUsage({ agents: [agent("codex", { days: [day("2026-09-28", { inputTokens: bad })] })] }, /^agents\[0\]\.days\[0\]\.inputTokens 必须是非负安全整数/);
  }
  rejectsUsage({ agents: [agent("codex", { sessionCount: -1 })] }, /^agents\[0\]\.sessionCount/);
  rejectsUsage({ agents: [agent("codex", { days: [day("2026-09-28", { reasoningTokens: 21 })] })] }, /reasoningTokens 不能大于 outputTokens/);
});

test("用量：totalTokens 不能小于四列之和（reasoning 是 output 的子集，不算在内）", () => {
  rejectsUsage({ agents: [agent("codex", { days: [day("2026-09-28", { totalTokens: 99 })] })] }, /^agents\[0\]\.days\[0\]\.totalTokens 小于四列之和/);
});

test("用量：费用有限非负，costComplete 是布尔值", () => {
  for (const bad of [-0.01, Infinity, Number.NaN, "0.1", null]) {
    rejectsUsage({ agents: [agent("codex", { days: [day("2026-09-28", { apiEquivalentCostUSD: bad })] })] }, /apiEquivalentCostUSD 必须是有限非负数/);
  }
  rejectsUsage({ agents: [agent("codex", { days: [day("2026-09-28", { costComplete: "true" })] })] }, /costComplete 必须是布尔值/);
});

test("用量：模型最多 64 条、名字不超过 200 字符、不重复、合计不超过 totalTokens", () => {
  const many = Array.from({ length: 65 }, (_, index) => ({ model: `m${index}`, tokens: 1 }));
  rejectsUsage({ agents: [agent("cursor", { days: [day("2026-09-28", { models: many })] })] }, /models 最多 64 条/);
  rejectsUsage({ agents: [agent("cursor", { days: [day("2026-09-28", { models: [{ model: "m".repeat(201), tokens: 1 }] })] })] }, /models\[0\]\.model 超过 200 个字符/);
  rejectsUsage({ agents: [agent("cursor", { days: [day("2026-09-28", { models: [{ model: "a", tokens: 1 }, { model: "a", tokens: 2 }] })] })] }, /models\[1\]\.model 重复/);
  rejectsUsage({ agents: [agent("cursor", { days: [day("2026-09-28", { models: [{ model: "a", tokens: 101 }] })] })] }, /^agents\[0\]\.days\[0\]\.models 合计超过 totalTokens/);
  rejectsUsage({ agents: [agent("cursor", { days: [day("2026-09-28", { models: undefined })] })] }, /models 必须是数组/);
  // 占位名原样收下，排名时才按隐藏名单跳过
  const [row] = usage(agent("codex", { days: [day("2026-09-28", { models: [{ model: "", tokens: 5 }, { model: "unknown", tokens: 5 }] })] })).agents;
  assert.deepEqual(row.days?.[0]?.models.map((entry) => entry.model), ["", "unknown"]);
});

test("用量：日期是合法的 YYYY-MM-DD、不重复，最多 4000 天", () => {
  for (const date of ["2026-9-28", "2026-02-30", "2026-13-01", "20260928", null]) {
    rejectsUsage({ agents: [agent("codex", { days: [day(date as string)] })] }, /^agents\[0\]\.days\[0\]\.date/);
  }
  rejectsUsage({ agents: [agent("codex", { days: [day("2026-09-28"), day("2026-09-28")] })] }, /^agents\[0\]\.days\[1\]\.date 重复/);
  const start = Date.parse("2010-01-01T00:00:00Z");
  const days = Array.from({ length: 4_001 }, (_, index) => day(new Date(start + index * 86_400_000).toISOString().slice(0, 10)));
  rejectsUsage({ agents: [agent("codex", { days })] }, /^agents\[0\]\.days 最多 4000 条/);
});

test("用量：collectedAt 最多比收到时刻晚 60 秒", () => {
  assert.equal(usage(agent("codex", { collectedAt: NOW + MIN })).agents[0].collectedAt, NOW + MIN);
  rejectsUsage({ agents: [agent("codex", { collectedAt: NOW + MIN + 1 })] }, /^agents\[0\]\.collectedAt 晚于收到时刻超过 60 秒/);
  rejectsUsage({ agents: [agent("codex", { collectedAt: new Date(NOW).toISOString() })] }, /^agents\[0\]\.collectedAt 必须是非负安全整数/);
});

test("活动：按 id 收最近事件的时刻与模型；agents 可以为空（只说采集器还活着）", () => {
  const report = normalizeCodingActivityReport({
    collectedAt: NOW,
    agents: [
      { id: "claude", lastActivityAt: NOW - 30_000, model: "claude-opus-5" },
      { id: "grok", lastActivityAt: null, model: null },
      { id: "codex" },
    ],
  }, NOW);
  assert.deepEqual(report, {
    collectedAt: NOW,
    agents: [
      { id: "claude", lastActivityAt: NOW - 30_000, model: "claude-opus-5" },
      { id: "grok", lastActivityAt: null, model: null },
      { id: "codex", lastActivityAt: null, model: null },
    ],
  });
  assert.deepEqual(normalizeCodingActivityReport({ collectedAt: NOW, agents: [] }, NOW), { collectedAt: NOW, agents: [] });
});

test("活动：collectedAt 必带；时刻不能晚于收到时刻 60 秒以上；id 不重复；模型是字符串", () => {
  const activity = (input: unknown) => () => normalizeCodingActivityReport(input, NOW);
  assert.throws(activity({ agents: [] }), { message: /^collectedAt 必须是非负安全整数/ });
  assert.throws(activity({ collectedAt: NOW + 2 * MIN, agents: [] }), { message: /^collectedAt 晚于收到时刻超过 60 秒/ });
  assert.throws(activity({ collectedAt: NOW, agents: [{ id: "claude", lastActivityAt: NOW + 2 * MIN }] }), { message: /^agents\[0\]\.lastActivityAt 晚于收到时刻/ });
  assert.throws(activity({ collectedAt: NOW, agents: [{ id: "claude" }, { id: "claude" }] }), { message: /^agents\[1\]\.id 重复/ });
  assert.throws(activity({ collectedAt: NOW, agents: [{ id: "claude", model: 5 }] }), { message: /^agents\[0\]\.model 必须是字符串/ });
  assert.throws(activity({ collectedAt: NOW, agents: {} }), { message: /^agents 必须是数组/ });
});

const T0 = Math.floor(NOW / CODING_BUCKET_MS) * CODING_BUCKET_MS - 60 * MIN;

function row(id: string, model: string | null, extra: Record<string, unknown> = {}) {
  return { id, model, inputTokens: 100, outputTokens: 20, cacheReadTokens: 900, cacheCreationTokens: 50, reasoningTokens: 10, eventCount: 2, ...extra };
}

function buckets(extra: Record<string, unknown> = {}) {
  return {
    from: T0 + 2 * MIN,
    to: NOW - MIN,
    collectedAt: NOW,
    agents: [{ id: "codex", state: "ok" }, { id: "claude", state: "partial" }],
    windows: [
      { from: T0 + 5 * MIN, agents: [row("claude", null, { eventCount: null })] },
      { from: T0, agents: [row("codex", "gpt-5.5"), row("codex", null), row("claude", "gpt-5.5")] },
    ],
    ...extra,
  };
}

const bucketReport = (input: unknown) => normalizeCodingTokenBucketReport(input, NOW);

test("桶：窗口按起点排好；首桶可以被报告范围截断；eventCount 可以为 null", () => {
  const report = bucketReport(buckets());
  assert.deepEqual(report.windows.map((window) => window.from), [T0, T0 + 5 * MIN]);
  assert.deepEqual(report.agents, [{ id: "codex", state: "ok" }, { id: "claude", state: "partial" }]);
  assert.equal(report.windows[1]?.agents[0]?.eventCount, null);
  // 同一窗口里 (agent, null) 和 (agent, 模型) 是两行
  assert.equal(report.windows[0]?.agents.length, 3);
});

test("桶：报告范围 —— to 晚于 from、不晚于 collectedAt、跨度不超过 25 小时", () => {
  assert.throws(() => bucketReport(buckets({ to: T0 + 2 * MIN })), { message: /^to 必须晚于 from/ });
  assert.throws(() => bucketReport(buckets({ to: NOW + 1 })), { message: /^to 不能晚于 collectedAt/ });
  assert.throws(() => bucketReport(buckets({ from: NOW - MIN - 25 * 3_600_000 - 1, windows: [] })), { message: /^to 距 from 超过 25 小时/ });
  assert.throws(() => bucketReport(buckets({ collectedAt: NOW + 2 * MIN })), { message: /^collectedAt 晚于收到时刻超过 60 秒/ });
});

test("桶：窗口起点对齐 5 分钟、落在 [floor(from), to)、不重复；每封最多 400 窗", () => {
  const windows = (from: number) => [{ from, agents: [] }];
  assert.throws(() => bucketReport(buckets({ windows: windows(T0 + MIN) })), { message: /^windows\[0\]\.from 必须对齐 5 分钟/ });
  assert.throws(() => bucketReport(buckets({ windows: windows(T0 - CODING_BUCKET_MS) })), { message: /^windows\[0\]\.from 落在报告范围外/ });
  assert.throws(() => bucketReport(buckets({ to: T0 + 10 * MIN, windows: windows(T0 + 10 * MIN) })), { message: /^windows\[0\]\.from 落在报告范围外/ });
  assert.throws(() => bucketReport(buckets({ windows: [{ from: T0, agents: [] }, { from: T0, agents: [] }] })), { message: /^windows\[1\]\.from 重复/ });
  assert.throws(() => bucketReport(buckets({ windows: Array.from({ length: 401 }, () => ({ from: T0, agents: [] })) })), { message: /^windows 最多 400 条/ });
});

test("桶：行里的 agent 要先声明；同一窗口 agent × 模型不重复；每窗最多 64 行", () => {
  const within = (agents: unknown[]) => buckets({ windows: [{ from: T0, agents }] });
  assert.throws(() => bucketReport(within([row("cursor", null)])), { message: /^windows\[0\]\.agents\[0\]\.id 没在 agents 里声明/ });
  assert.throws(() => bucketReport(within([row("codex", null), row("codex", null)])), { message: /^windows\[0\]\.agents\[1\] 同一窗口里 agent 与模型重复/ });
  assert.throws(() => bucketReport(within([row("codex", "a"), row("codex", "a")])), { message: /同一窗口里 agent 与模型重复/ });
  const many = Array.from({ length: 65 }, (_, index) => row("codex", `m${index}`));
  assert.throws(() => bucketReport(within(many)), { message: /^windows\[0\]\.agents 最多 64 条/ });
});

test("桶：计数规则与日行一致，agent 状态只认三种、id 不重复", () => {
  const within = (agents: unknown[]) => buckets({ windows: [{ from: T0, agents }] });
  assert.throws(() => bucketReport(within([row("codex", null, { reasoningTokens: 21 })])), { message: /reasoningTokens 不能大于 outputTokens/ });
  assert.throws(() => bucketReport(within([row("codex", null, { cacheReadTokens: -1 })])), { message: /cacheReadTokens 必须是非负安全整数/ });
  assert.throws(() => bucketReport(within([row("codex", null, { eventCount: 1.5 })])), { message: /eventCount 必须是非负安全整数/ });
  assert.throws(() => bucketReport(buckets({ agents: [{ id: "codex", state: "stale" }] })), { message: /^agents\[0\]\.state 必须是 ok、partial 或 unavailable/ });
  assert.throws(() => bucketReport(buckets({ agents: [{ id: "codex", state: "ok" }, { id: "codex", state: "ok" }] })), { message: /^agents\[1\]\.id 重复/ });
  // 没有声明任何 agent 也合规：这一段什么都不覆盖
  assert.deepEqual(bucketReport(buckets({ agents: [], windows: [] })).windows, []);
});

test("来源：有账号级来源就只算它，别的同 agent 来源靠边站；否则全部相加；结果按登记顺序", () => {
  assert.deepEqual(CODING_USAGE_SOURCE_NAMES, ["mac", "agents", "agents-otlp"]);
  assert.deepEqual(resolveCodingUsageSources(["mac"]), { contributing: ["mac"], superseded: [], conflict: [] });
  assert.deepEqual(resolveCodingUsageSources(["agents-otlp", "mac"]), { contributing: ["mac", "agents-otlp"], superseded: [], conflict: [] });
  assert.deepEqual(resolveCodingUsageSources(["mac", "agents", "agents-otlp"]), {
    contributing: ["agents"], superseded: ["mac", "agents-otlp"], conflict: [],
  });
  assert.deepEqual(contributingSources(["agents-otlp", "agents"]), ["agents"]);
  assert.deepEqual(contributingSources([]), []);
  assert.equal(isCodingUsageSource("agents-otlp"), true);
  assert.equal(isCodingUsageSource("toString"), false);
  assert.equal(isCodingUsageSource("cursor"), false);
});

test("模型：占位名不当模型名，也不进排名", () => {
  for (const model of ["", "unknown", "codex-auto-review", "<synthetic>", null, undefined]) {
    assert.equal(isVisibleCodingModel(model), false, String(model));
  }
  assert.equal(isVisibleCodingModel("claude-opus-5"), true);
});
