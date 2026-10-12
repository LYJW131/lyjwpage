import assert from "node:assert/strict";
import test from "node:test";

import { addBucketDeltas, CODING_BUCKET_KEEP_MS, mergeBucketReport, parseStoredCodingBuckets } from "@shared/coding-buckets";
import type { CodingTokenBucketReport, CodingTokenBucketRow } from "@shared/coding-usage";

const M = 60_000;
const T0 = Date.parse("2026-09-29T04:00:00Z");

function row(id: string, model: string | null, inputTokens: number): CodingTokenBucketRow {
  return { id, model, inputTokens, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0, eventCount: 1 };
}

function report(from: number, to: number, windows: Array<[number, CodingTokenBucketRow[]]>): CodingTokenBucketReport {
  return { from, to, collectedAt: to, agents: [{ id: "claude", state: "ok" }], windows: windows.map(([start, agents]) => ({ from: start, agents })) };
}

test("范围内以新报告为准（包括还在累积的末桶），范围外不动，覆盖区间取并集", () => {
  const first = mergeBucketReport(null, report(T0, T0 + 12 * M, [[T0, [row("claude", "m", 30)]], [T0 + 5 * M, [row("claude", "m", 12)]], [T0 + 10 * M, [row("claude", "m", 1)]]]), T0 + 12 * M)!;
  const second = mergeBucketReport(first, report(T0 + 5 * M, T0 + 17 * M, [[T0 + 5 * M, [row("claude", "m", 20)]], [T0 + 15 * M, [row("claude", "m", 4)]]]), T0 + 17 * M)!;
  assert.deepEqual(second.windows.map((window) => [window.from, window.agents[0]?.inputTokens]), [
    [T0, 30],
    [T0 + 5 * M, 20],
    [T0 + 15 * M, 4],
  ]);
  assert.deepEqual(second.coverage, [{ from: T0, to: T0 + 17 * M }]);
});

test("跨着报告起点的那一桶只数了后半截：不拿它盖掉数全了的旧桶", () => {
  const first = mergeBucketReport(null, report(T0, T0 + 10 * M, [[T0, [row("claude", "m", 30), row("claude", "n", 1)]]]), T0 + 10 * M)!;
  const second = mergeBucketReport(first, report(T0 + 2 * M, T0 + 12 * M, [[T0, [row("claude", "m", 4), row("claude", "n", 5), row("codex", null, 2)]]]), T0 + 12 * M)!;
  assert.deepEqual(second.windows[0]?.agents.map((entry) => [entry.id, entry.model, entry.inputTokens]), [
    ["claude", "m", 30],
    ["claude", "n", 5],
    ["codex", null, 2],
  ]);
});

test("采集时刻比已存的旧就不收；24 小时之外的桶和覆盖清掉", () => {
  const first = mergeBucketReport(null, report(T0, T0 + 10 * M, [[T0, [row("claude", "m", 30)]]]), T0 + 10 * M)!;
  assert.equal(mergeBucketReport(first, report(T0, T0 + 5 * M, []), T0 + 11 * M), null);
  const later = T0 + CODING_BUCKET_KEEP_MS + 30 * M;
  const pruned = mergeBucketReport(first, report(later - 10 * M, later, [[later - 10 * M, [row("claude", "m", 1)]]]), later)!;
  assert.deepEqual(pruned.windows.map((window) => window.from), [later - 10 * M]);
  assert.deepEqual(pruned.coverage, [{ from: later - 10 * M, to: later }]);
  assert.deepEqual(parseStoredCodingBuckets(JSON.stringify(pruned)), pruned);
  assert.equal(parseStoredCodingBuckets("{nope"), null);
});

test("OTLP 的正差值加进所在的桶，没有覆盖区间，事件数是 null", () => {
  const first = addBucketDeltas(null, [
    { at: T0 + 30_000, id: "claude", model: "claude-fable-5", inputTokens: 10, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 },
    { at: T0 + 4 * M, id: "claude", model: "claude-fable-5", inputTokens: 5, outputTokens: 0, cacheReadTokens: 7, cacheCreationTokens: 0 },
  ], T0 + 5 * M);
  const second = addBucketDeltas(first, [
    { at: T0 + 6 * M, id: "claude", model: null, inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 2 },
  ], T0 + 7 * M);
  assert.deepEqual(second.coverage, []);
  assert.deepEqual(second.agents, [{ id: "claude", state: "partial" }]);
  assert.deepEqual(second.windows, [
    { from: T0, agents: [{ id: "claude", model: "claude-fable-5", inputTokens: 15, outputTokens: 1, cacheReadTokens: 7, cacheCreationTokens: 0, reasoningTokens: 0, eventCount: null }] },
    { from: T0 + 5 * M, agents: [{ id: "claude", model: null, inputTokens: 1, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 2, reasoningTokens: 0, eventCount: null }] },
  ]);
  assert.equal(second.receivedAt, T0 + 7 * M);
});
