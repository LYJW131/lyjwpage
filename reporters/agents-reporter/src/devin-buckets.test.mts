import assert from "node:assert/strict";
import test from "node:test";

const { advanceDevinLedger, devinBucketReport, devinSnapshot } = await import("../dist/devin-buckets.js");

const M = 60_000;
const T0 = Date.parse("2026-10-14T04:00:00Z");
const tokens = (input: number, output = 0, cacheRead = 0) => ({ input, output, cacheRead, cacheWrite: 0, reasoning: 0 });
const snapshot = (at: number, models: Record<string, ReturnType<typeof tokens>>, date = "2026-10-14") => devinSnapshot([{ date, models }], at, at);

test("第一次只立基线，不发桶", () => {
  const ledger = advanceDevinLedger(null, snapshot(T0 + 2 * M, { swe: tokens(1_000) }), "devin", T0 + 3 * M);
  assert.deepEqual(ledger.windows, []);
  assert.equal(ledger.since, T0 + 2 * M);
});

test("两次提交之间的增量按时长摊进 5 分钟桶，总数一个不差", () => {
  const first = advanceDevinLedger(null, snapshot(T0 + 2 * M, { swe: tokens(1_000, 10) }), "devin", T0 + 2 * M);
  const second = advanceDevinLedger(first, snapshot(T0 + 12 * M, { swe: tokens(1_000 + 1_001, 10 + 3, 50) }), "devin", T0 + 13 * M);
  assert.deepEqual(second.windows.map((window) => [window.from, window.agents[0].inputTokens]), [
    [T0, 300],
    [T0 + 5 * M, 501],
    [T0 + 10 * M, 200],
  ]);
  const sum = (field: "inputTokens" | "outputTokens" | "cacheReadTokens") => second.windows.reduce((total, window) => total + window.agents[0][field], 0);
  assert.equal(sum("inputTokens"), 1_001);
  assert.equal(sum("outputTokens"), 3);
  assert.equal(sum("cacheReadTokens"), 50);
  assert.equal(second.since, first.since);
});

test("跨日：新日期整份算增量，旧日期只算涨的部分；回落不算负数，回升只算超过历来最高的部分", () => {
  const first = advanceDevinLedger(null, devinSnapshot([{ date: "2026-10-13", models: { swe: tokens(500) } }], T0, T0), "devin", T0);
  const second = advanceDevinLedger(first, devinSnapshot([
    { date: "2026-10-13", models: { swe: tokens(520), compactor: tokens(0) } },
    { date: "2026-10-14", models: { swe: tokens(30) } },
  ], T0 + 4 * M, T0 + 4 * M), "devin", T0 + 4 * M);
  assert.deepEqual(second.windows, [{ from: T0, agents: [{ id: "devin", model: "swe", inputTokens: 50, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0, eventCount: null }] }]);
  const third = advanceDevinLedger(second, devinSnapshot([{ date: "2026-10-14", models: { swe: tokens(10) } }], T0 + 6 * M, T0 + 6 * M), "devin", T0 + 6 * M);
  assert.deepEqual(third.windows, second.windows);
  const fourth = advanceDevinLedger(third, devinSnapshot([{ date: "2026-10-14", models: { swe: tokens(45) } }], T0 + 8 * M, T0 + 8 * M), "devin", T0 + 8 * M);
  assert.equal(fourth.windows.reduce((sum, window) => sum + window.agents[0].inputTokens, 0), 50 + 15);
  assert.equal(fourth.snapshot.days["2026-10-13"].swe.input, 520);
});

test("报告从账本起点或 24 小时前开始，到最后一次提交为止；隔了一天以上就重立基线", () => {
  const first = advanceDevinLedger(null, snapshot(T0 + 2 * M, { swe: tokens(0) }), "devin", T0 + 2 * M);
  const second = advanceDevinLedger(first, snapshot(T0 + 12 * M, { swe: tokens(1_000) }), "devin", T0 + 12 * M);
  const report = devinBucketReport(second, "devin", T0 + 14 * M);
  assert.equal(report.from, T0);
  assert.equal(report.to, T0 + 12 * M);
  assert.equal(report.collectedAt, T0 + 14 * M);
  assert.deepEqual(report.agents, [{ id: "devin", state: "ok" }]);
  assert.equal(report.windows.length, 3);
  const later = T0 + 30 * 3_600_000;
  const rebased = advanceDevinLedger(second, snapshot(later, { swe: tokens(5_000) }), "devin", later);
  assert.deepEqual(rebased.windows, []);
  assert.equal(rebased.since, later);
  assert.deepEqual(devinBucketReport(first, "devin", T0 + 2 * M).windows, []);
  assert.equal(devinBucketReport(advanceDevinLedger(null, snapshot(T0, { swe: tokens(0) }), "devin", T0), "devin", T0 + M), null);
});

test("tokens.ci 的提交时刻没往前走就不摊，涨的部分等下一次提交一起算", () => {
  const first = advanceDevinLedger(null, snapshot(T0 + 2 * M, { swe: tokens(10) }), "devin", T0 + 2 * M);
  const same = advanceDevinLedger(first, snapshot(T0 + 2 * M, { swe: tokens(110) }), "devin", T0 + 4 * M);
  assert.equal(same, first);
  const next = advanceDevinLedger(same, snapshot(T0 + 7 * M, { swe: tokens(160) }), "devin", T0 + 8 * M);
  assert.deepEqual(next.windows.map((window) => [window.from, window.agents[0].inputTokens]), [[T0, 90], [T0 + 5 * M, 60]]);
});
