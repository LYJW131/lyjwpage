import assert from "node:assert/strict";
import test from "node:test";

import { installLagReader } from "@shared/lag";
import type { CodingYearPayload, GithubChartPayload } from "@shared/types";

import { executePublicRequest } from "./public-execution";
import type { Env } from "./runtime";
import { WEEK_CARD_PATH, formatTokens, monotonePath, renderWeekCard, weekCardStats } from "./week-card";

const year: CodingYearPayload = {
  origin: "2026-10-01",
  days: [...Array(10).fill(0), 1_000, 2_000, 3_000, 4_000, 5_000, 6_000, 7_000, 800, 0, 0, 0],
  models: [],
  mix: [],
  updatedAt: 0,
  todayAtSource: "2026-10-18",
};
const chart: GithubChartPayload = {
  origin: "2026-10-05",
  counts: [0, 0, 0, 0, 0, 0, 131, 162, 332, 439, 129, 73, 6, 33],
};

test("八天按各自 origin 对齐到 todayAtSource，尾部补齐的 0 不算进去", () => {
  const stats = weekCardStats(year, { totalTokens: 56_000, activeDays: 14 }, chart);
  assert.deepEqual(stats.dates, ["2026-10-11", "2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17", "2026-10-18"]);
  assert.deepEqual(stats.tokens, [1_000, 2_000, 3_000, 4_000, 5_000, 6_000, 7_000, 800]);
  assert.deepEqual(stats.commits, [131, 162, 332, 439, 129, 73, 6, 33]);
  assert.equal(stats.tokenAvgAllTime, 4_000);
  assert.equal(stats.commitAvgAllTime, 1_305 / 8);
});

test("GitHub 日历还没到今天时今天记 0", () => {
  const stats = weekCardStats(year, null, { origin: chart.origin, counts: chart.counts.slice(0, -1) });
  assert.equal(stats.commits[7], 0);
  assert.equal(stats.tokenAvgAllTime, 0);
});

test("卡片与 Voronoi 卡同宽，柱子铺满 x=28..752", () => {
  const svg = renderWeekCard(weekCardStats(year, { totalTokens: 56_000, activeDays: 14 }, chart));
  assert.match(svg, /^<svg [^>]*width="724"[^>]*viewBox="28 0 724 262"/);
  const rects = [...svg.matchAll(/<rect x="([\d.]+)"[^>]*width="([\d.]+)"/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.equal(rects.length, 8);
  assert.equal(rects[0][0], 28);
  assert.equal(rects[1][0] - rects[0][0] - rects[0][1], 18);
  assert.equal(rects[7][0] + rects[7][1], 752);
  assert.match(svg, /7D TOKENS/);
  assert.match(svg, />今天</);
  assert.match(svg, /▲ 1\.0×/);
  assert.match(svg, /▼ 80%/);
});

test("曲线是单调插值，平段不出现过冲", () => {
  const d = monotonePath([0, 10, 20, 30], [5, 5, 0, 0]);
  const ys = [...d.matchAll(/,(-?[\d.]+)/g)].map((m) => Number(m[1]));
  assert.ok(ys.every((y) => y >= 0 && y <= 5), d);
});

test("token 数按量级缩写", () => {
  assert.equal(formatTokens(18_820_000_000), "18.82B");
  assert.equal(formatTokens(861_400_000), "861.4M");
  assert.equal(formatTokens(12_300), "12.3K");
});

test("还没有数据时回 503 且只短暂缓存", async (t) => {
  installLagReader(async () => null);
  t.after(() => installLagReader(null));
  t.mock.method(console, "warn", () => {});
  const hub = new Proxy({}, { get: (_, method: string) => (method === "then" ? undefined : async () => []) });
  const env = { STATE: { idFromName: () => ({}), get: () => hub } } as unknown as Env;
  const response = await executePublicRequest(new Request(`https://api.test${WEEK_CARD_PATH}`), env, { waitUntil: () => {} });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=60");
});
