import assert from "node:assert/strict";
import test from "node:test";

import { installLagReader } from "@shared/lag";
import type { StorageCommand } from "@shared/storage-contract";
import type { CodingUsagePayload } from "@shared/types";

import { installApiPorts } from "./ports";
import { executePublicRequest } from "./public-execution";
import type { Env } from "./runtime";
import { INITIAL_VORONOI_STATE, VORONOI_CARD_PATH, parseVoronoiState, renderVoronoiCard } from "./voronoi-card";
import { INITIAL_VORONOI_LAYOUT } from "./voronoi-initial";
import { renderWeekCard, weekCardStats } from "./week-card";
import {
  MH,
  MW,
  MX,
  MY,
  SEARCH_SEEDS,
  STRETCH,
  fitLayout,
  shareCells,
  solveSeed,
  type ShareCell,
  type VoronoiLayout,
} from "./voronoi-layout";
import { FAILED_SEARCH_RETRY_MS, RELAYOUT_COOLDOWN_MS, relayoutRound, type VoronoiState } from "./voronoi-relayout";

installApiPorts();

const B = 1e9;
const cellsOf = (rows: [string, number][]): ShareCell[] => rows.map(([model, tokens]) => ({ model, tokens: tokens * B }));
const REFERENCE = cellsOf([
  ["claude-opus-5-5", 22.12], ["claude-opus-5", 11.05], ["swe-2-max", 4.88], ["gpt-5.6-sol", 2.39],
  ["gpt-6.1-sol", 2.37], ["claude-sonnet-5-5", 1.46], ["claude-fable-5", 1.45], ["other", 12.83],
]);
const pathOf = (poly: [number, number][]) => `M${poly.map((q) => `${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join(" L")} Z`;
const DAY = 86_400_000;
const NOW = INITIAL_VORONOI_LAYOUT.chosenAt + 10 * DAY;
const steadyState = (layout: VoronoiLayout = INITIAL_VORONOI_LAYOUT, lastRelayoutAt = NOW - 10 * DAY): VoronoiState => ({
  layout, lastRelayoutAt, lastFailedSearchAt: null, search: null,
});

// 横排一行的站点会切出贯穿上下的竖条，是确定会触发硬性问题的坏布局。
const stripLayout = (cells: ShareCell[]): VoronoiLayout => ({
  cells: cells.map((c, i) => ({ model: c.model, color: "#3178c6", site: [MX + ((i + 0.5) / cells.length) * MW, (MY + MH / 2) * STRETCH], weight: 0 })),
  chosenScore: 100,
  chosenAt: NOW - 10 * DAY,
  seed: null,
  accepted: [],
});

test("seed 2290 复现参考卡的格子，存好的初始布局按同一份额重建也一致", () => {
  const solved = solveSeed(2290, REFERENCE);
  assert.equal(pathOf(solved.polys[0]), "M319.6 260.3 L309.4 314.0 L79.8 314.0 L43.3 245.1 L124.6 160.2 L186.6 146.1 L272.7 175.8 Z");
  const fit = fitLayout(INITIAL_VORONOI_LAYOUT, REFERENCE);
  assert.equal(fit.structureChanged, false);
  fit.solved.polys.forEach((poly, i) => assert.equal(pathOf(poly), pathOf(solved.polys[i])));
  assert.deepEqual(fit.assessment.hard, ["wedge"]);
});

test("名次互换不改结构，颜色跟着模型走，图例按最新份额排序", () => {
  const swapped = REFERENCE.map((c) => (c.model === "gpt-6.1-sol" ? { ...c, tokens: 2.6 * B } : c));
  const fit = fitLayout(INITIAL_VORONOI_LAYOUT, swapped);
  assert.equal(fit.structureChanged, false);
  assert.deepEqual(fit.layout.cells.map((c) => c.color), INITIAL_VORONOI_LAYOUT.cells.map((c) => c.color));
  const svg = renderVoronoiCard(fit, { totalTokens: 58.8 * B, apiEquivalentCostUSD: 32_000, activeDays: 280 });
  assert.ok(svg.indexOf(">gpt-6.1-sol<") < svg.indexOf(">gpt-5.6-sol<"));
  assert.match(svg, /fill="#00add8" fill-opacity=".9"\/><text x="562" y="211.4"[^>]*>gpt-6.1-sol</);
  assert.ok(fit.assessment.errMaxPct <= 0.05);
});

test("统计列与周卡同一网格，图例的小用量按 K 显示，与周卡同一格式", () => {
  const small = REFERENCE.map((c) => (c.model === "claude-fable-5" ? { ...c, tokens: 30_000 } : c));
  const svg = renderVoronoiCard(fitLayout(INITIAL_VORONOI_LAYOUT, small), { totalTokens: 57.4 * B, apiEquivalentCostUSD: 32_000, activeDays: 280 });
  const week = renderWeekCard(weekCardStats({ origin: "2026-10-01", days: [1], models: [], mix: [], updatedAt: 0, todayAtSource: "2026-10-01" }, null, { origin: "2026-10-01", counts: [1] }));
  const columns = (card: string) => [...card.matchAll(/<text x="(\d+)" y="34"/g)].map((m) => Number(m[1]));
  assert.deepEqual(columns(svg), columns(week));
  assert.match(svg, />30\.0K</);
  assert.doesNotMatch(svg, />0\.0M</);
});

const fableSwapped = REFERENCE.map((c) => (c.model === "claude-fable-5" ? { model: "claude-fable-5-1", tokens: c.tokens } : c));
const eighthJoins = [...REFERENCE.slice(0, 7), { model: "grok-4.6-build", tokens: 0.5 * B }, { model: "other", tokens: 12.33 * B }];

test("第 7 名换人：新模型原地接过站点、接过空出来的颜色，其余格子不动", () => {
  const fit = fitLayout(INITIAL_VORONOI_LAYOUT, fableSwapped);
  assert.equal(fit.structureChanged, true);
  const slot = INITIAL_VORONOI_LAYOUT.cells.findIndex((c) => c.model === "claude-fable-5");
  assert.equal(fit.layout.cells[slot].model, "claude-fable-5-1");
  assert.equal(fit.layout.cells[slot].color, "#db61a2");
  fit.solved.polys.forEach((poly, i) => assert.equal(pathOf(poly), pathOf(fitLayout(INITIAL_VORONOI_LAYOUT, REFERENCE).solved.polys[i])));
});

test("没有空出来的站点可接时，新模型插在 other 中心附近，只有它和 other 挪位置", () => {
  const fit = fitLayout(INITIAL_VORONOI_LAYOUT, eighthJoins);
  assert.equal(fit.structureChanged, true);
  assert.equal(fit.layout.cells.at(-1)?.model, "grok-4.6-build");
  INITIAL_VORONOI_LAYOUT.cells.forEach((c, i) => {
    if (c.model !== "other") assert.deepEqual(fit.layout.cells[i].site, c.site);
  });
  assert.ok(fit.assessment.errMaxPct <= 0.05);
});

test("跌出前 7 的模型回榜时，原色空着就还给它", () => {
  const step1 = fitLayout(INITIAL_VORONOI_LAYOUT, fableSwapped).layout;
  const back = fableSwapped
    .filter((c) => c.model !== "gpt-5.6-sol" && c.model !== "claude-fable-5-1")
    .flatMap((c) => (c.model === "other" ? [{ model: "claude-fable-5", tokens: 2.39 * B }, { model: "grok-4.6-build", tokens: 1.45 * B }, c] : [c]));
  const step2 = fitLayout(step1, back).layout;
  assert.equal(step2.cells.find((c) => c.model === "claude-fable-5")?.color, "#db61a2");
  assert.equal(step2.cells.find((c) => c.model === "grok-4.6-build")?.color, "#89e051");
});

test("认可过的问题消失后从认可里去掉，再出现就算新出现", () => {
  const layout = { ...INITIAL_VORONOI_LAYOUT, accepted: ["wedge:claude-fable-5:t", "span:other"] };
  const result = relayoutRound(steadyState(layout), REFERENCE, NOW, 0);
  assert.equal(result.event.kind, "steady");
  assert.equal(result.changed, true);
  assert.deepEqual(result.state.layout.accepted, ["wedge:claude-fable-5:t"]);
  const pruned = relayoutRound(steadyState({ ...INITIAL_VORONOI_LAYOUT, accepted: ["span:other"] }, NOW - DAY / 2), REFERENCE, NOW, 1);
  assert.equal(pruned.state.search?.hard, true);
  assert.deepEqual(pruned.state.layout.accepted, []);
});

test("份额没变时这一轮什么都不写", () => {
  const result = relayoutRound(steadyState(), REFERENCE, NOW);
  assert.equal(result.event.kind, "steady");
  assert.equal(result.changed, false);
});

test("结构变化后通过质量检查就沿用，选定分换成新结构下的分", () => {
  const result = relayoutRound(steadyState(), fableSwapped, NOW, 0);
  assert.deepEqual(result.event, { kind: "adapted" });
  assert.equal(result.changed, true);
  assert.equal(result.state.layout.chosenScore, fitLayout(INITIAL_VORONOI_LAYOUT, fableSwapped).assessment.score);
  assert.deepEqual(result.state.layout.accepted, ["wedge:claude-fable-5-1:t"]);
  assert.equal(relayoutRound(result.state, fableSwapped, NOW + 300_000, 0).event.kind, "steady");
});

test("结构变化后没通过质量检查就整体重新搜索，硬性问题不等冷却期", () => {
  const result = relayoutRound(steadyState(INITIAL_VORONOI_LAYOUT, NOW - DAY / 2), eighthJoins, NOW, 1);
  assert.deepEqual(result.event, { kind: "searching", next: 2 });
  assert.equal(result.state.search?.hard, true);
  assert.ok(result.state.layout.cells.some((c) => c.model === "grok-4.6-build"));
});

test("软性变差在冷却期内只标记，不搜索", () => {
  const layout = { ...INITIAL_VORONOI_LAYOUT, chosenScore: 50 };
  const result = relayoutRound(steadyState(layout, NOW - DAY / 2), REFERENCE, NOW, 0);
  assert.equal(result.event.kind, "due");
  if (result.event.kind === "due") {
    assert.equal(result.event.soft, true);
    assert.deepEqual(result.event.hard, []);
    assert.equal(result.event.waitingUntil, NOW - DAY / 2 + RELAYOUT_COOLDOWN_MS);
  }
  assert.equal(result.state.search, null);
});

test("软性变差过了冷却期就开始分段搜索", () => {
  const layout = { ...INITIAL_VORONOI_LAYOUT, chosenScore: 50 };
  const result = relayoutRound(steadyState(layout, NOW - 2 * DAY), REFERENCE, NOW, 2);
  assert.deepEqual(result.event, { kind: "searching", next: 3 });
  assert.equal(result.changed, true);
  assert.equal(result.state.search?.hard, false);
  assert.equal(result.state.layout, layout);
});

test("硬性问题不等冷却期，选定时已认可的问题不算", () => {
  const unaccepted = { ...INITIAL_VORONOI_LAYOUT, accepted: [] };
  const result = relayoutRound(steadyState(unaccepted, NOW - DAY / 2), REFERENCE, NOW, 1);
  assert.deepEqual(result.event, { kind: "searching", next: 2 });
  assert.equal(result.state.search?.hard, true);
  assert.equal(relayoutRound(steadyState(INITIAL_VORONOI_LAYOUT, NOW - DAY / 2), REFERENCE, NOW, 1).event.kind, "steady");
});

test("同类问题换了地方也算新出现：认可的是那一处，不是那一类", () => {
  const elsewhere = { ...INITIAL_VORONOI_LAYOUT, accepted: ["wedge:claude-opus-5:b"] };
  const result = relayoutRound(steadyState(elsewhere, NOW - DAY / 2), REFERENCE, NOW, 1);
  assert.equal(result.state.search?.hard, true);
  assert.deepEqual(result.state.layout.accepted, []);
});

test("搜索出的布局不比当前好 30% 就不换，失败后一天内不再搜", () => {
  const unaccepted = { ...INITIAL_VORONOI_LAYOUT, accepted: [] };
  const same = INITIAL_VORONOI_LAYOUT.cells;
  const state: VoronoiState = {
    ...steadyState(unaccepted, NOW - DAY / 2),
    search: {
      cells: REFERENCE, next: SEARCH_SEEDS + 1, startedAt: NOW - 3600_000, hard: true,
      best: { seed: 2290, score: 196, sites: same.map((c) => c.site), weights: same.map((c) => c.weight) },
    },
  };
  const result = relayoutRound(state, REFERENCE, NOW);
  assert.equal(result.event.kind, "kept");
  assert.equal(result.state.search, null);
  assert.equal(result.state.lastFailedSearchAt, NOW);
  assert.equal(result.state.layout.seed, 2290);
  const later = relayoutRound(result.state, REFERENCE, NOW + DAY / 2, 0);
  assert.equal(later.event.kind, "due");
  if (later.event.kind === "due") assert.equal(later.event.waitingUntil, NOW + FAILED_SEARCH_RETRY_MS);
});

test("搜索出的布局好 30% 以上就换，颜色沿用旧布局", () => {
  const bad = stripLayout(REFERENCE);
  const current = fitLayout(bad, REFERENCE).assessment;
  assert.ok(current.hard.includes("span"));
  const good = solveSeed(2637, REFERENCE);
  const state: VoronoiState = {
    ...steadyState(bad, NOW - DAY / 2),
    search: { cells: REFERENCE, next: SEARCH_SEEDS + 1, startedAt: NOW - 3600_000, hard: true, best: { seed: 2637, score: 197.5, sites: good.sites, weights: good.weights } },
  };
  const result = relayoutRound(state, REFERENCE, NOW);
  assert.equal(result.event.kind, "relayout");
  if (result.event.kind === "relayout") assert.ok(result.event.to <= result.event.from * 0.7);
  assert.equal(result.state.lastRelayoutAt, NOW);
  assert.equal(result.state.search, null);
  assert.equal(result.state.layout.seed, 2637);
  assert.deepEqual(result.state.layout.accepted, []);
  assert.ok(result.state.layout.cells.every((c) => c.color === (c.model === "other" ? "#6e7681" : "#3178c6")));
});

test("搜索途中前 7 名单变了就按新名单从头搜", () => {
  const latest = fableSwapped;
  const state: VoronoiState = {
    ...steadyState(),
    search: { cells: REFERENCE, next: 1201, startedAt: NOW - 3600_000, hard: false, best: null },
  };
  const result = relayoutRound(state, latest, NOW, 1);
  assert.deepEqual(result.event, { kind: "searching", next: 2 });
  assert.equal(result.state.search?.startedAt, NOW);
  assert.ok(result.state.search?.cells.some((c) => c.model === "claude-fable-5-1"));
});

test("存储里的状态读不出来就回到初始布局", () => {
  assert.equal(parseVoronoiState({ layout: { cells: [] } }), null);
  assert.deepEqual(parseVoronoiState(JSON.parse(JSON.stringify(INITIAL_VORONOI_STATE))), INITIAL_VORONOI_STATE);
});

test("前 7 之外合成 other，份额为 0 的不画", () => {
  const top = [7, 6, 5, 4, 3, 2, 1, 0.5].map((t, i) => ({ model: `m${i}`, tokens: t * B }));
  const cells = shareCells(30 * B, top);
  assert.deepEqual(cells.map((c) => c.model), ["m0", "m1", "m2", "m3", "m4", "m5", "m6", "other"]);
  assert.equal(cells[7].tokens, 2 * B);
  assert.equal(shareCells(28 * B, top.slice(0, 7)).length, 7);
  const named = shareCells(30 * B, [{ model: "other", tokens: 9 * B }, ...top.slice(0, 7)]);
  assert.deepEqual(named.map((c) => c.model), ["m0", "m1", "m2", "m3", "m4", "m5", "m6", "other"]);
  assert.equal(named[7].tokens, 2 * B);
});

test("GET /api/cards/voronoi.svg 回 SVG 和十分钟缓存头", async (t) => {
  installLagReader(async () => null);
  t.after(installApiPorts);
  const usage: CodingUsagePayload = {
    updatedAt: 0,
    totals: { totalTokens: 58.55 * B, apiEquivalentCostUSD: 32_439, activeDays: 280, modelCount: 1_204 } as CodingUsagePayload["totals"],
    topModels: REFERENCE.filter((c) => c.model !== "other"),
    agents: [],
  };
  const hub = {
    publicRead: async (commands: StorageCommand[]) => commands.map((c) => ("key" in c && c.key.endsWith(":coding:usage:view") ? JSON.stringify(usage) : null)),
  };
  const env = { STATE: { idFromName: () => ({}), get: () => hub } } as unknown as Env;
  const response = await executePublicRequest(new Request(`https://api.test${VORONOI_CARD_PATH}`), env, { waitUntil: () => {} });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Content-Type"), "image/svg+xml; charset=utf-8");
  assert.equal(response.headers.get("Cache-Control"), "public, max-age=600, stale-while-revalidate=3600");
  const svg = await response.text();
  assert.match(svg, /^<svg [^>]*viewBox="28 0 724 342" width="724" height="342"/);
  assert.match(svg, />58\.55B</);
  assert.match(svg, />\$32,439</);
  assert.match(svg, /<text x="408" y="34"[^>]*>MODELS<\/text><text x="408" y="76"[^>]*>1,204</);
  assert.match(svg, /<text x="598" y="34"[^>]*>ACTIVE DAYS<\/text><text x="598" y="76"[^>]*>280</);
});

test("存好的 coding 视图还没有 modelCount 时模型数画「—」", () => {
  const svg = renderVoronoiCard(fitLayout(INITIAL_VORONOI_LAYOUT, REFERENCE), { totalTokens: 58.55 * B, apiEquivalentCostUSD: 1, activeDays: 280 });
  assert.match(svg, />MODELS<\/text><text[^>]*>—</);
});
