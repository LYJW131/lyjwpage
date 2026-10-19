import { AwaitingReport } from "@shared/awaiting-report";
import { object } from "@shared/json";
import { mirrorKey } from "@shared/storage";
import type { CodingUsagePayload } from "@shared/types";

import { CARD_FONT, CARD_MONO, cardResponse, cardStat, cardStyle, formatTokens } from "./card-svg";
import { getCodingUsage } from "./coding-usage";
import { INITIAL_VORONOI_LAYOUT } from "./voronoi-initial";
import {
  MH,
  MW,
  MX,
  MY,
  OTHER_MODEL,
  fitLayout,
  shareCells,
  type Fitted,
  type LayoutCell,
  type ShareCell,
} from "./voronoi-layout";
import { relayoutRound, type VoronoiState } from "./voronoi-relayout";

export const VORONOI_CARD_PATH = "/api/cards/voronoi.svg";

const stateKey = mirrorKey<unknown>(["cards", "voronoi"]);

export const INITIAL_VORONOI_STATE: VoronoiState = {
  layout: INITIAL_VORONOI_LAYOUT,
  lastRelayoutAt: INITIAL_VORONOI_LAYOUT.chosenAt,
  lastFailedSearchAt: null,
  search: null,
};

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const point = (value: unknown) => Array.isArray(value) && value.length === 2 && value.every(finite);

function layoutCell(value: unknown): value is LayoutCell {
  const cell = object(value);
  return !!cell && typeof cell.model === "string" && typeof cell.color === "string" && point(cell.site) && finite(cell.weight);
}

export function parseVoronoiState(raw: unknown): VoronoiState | null {
  const state = object(raw);
  const layout = object(state?.layout);
  if (!state || !layout) return null;
  if (!Array.isArray(layout.cells) || !layout.cells.length || !layout.cells.every(layoutCell)) return null;
  if (!finite(layout.chosenScore) || !finite(layout.chosenAt) || !Array.isArray(layout.accepted)) return null;
  if (!layout.accepted.every((key) => typeof key === "string")) return null;
  const colors = layout.colors === undefined ? {} : object(layout.colors);
  if (!colors || !Object.values(colors).every((color) => typeof color === "string")) return null;
  if (!finite(state.lastRelayoutAt) || (state.lastFailedSearchAt !== null && !finite(state.lastFailedSearchAt))) return null;
  const search = object(state.search);
  if (state.search !== null && (!search || !Array.isArray(search.cells) || !finite(search.next))) return null;
  return state as unknown as VoronoiState;
}

async function loadState(): Promise<VoronoiState> {
  const raw = await stateKey.get();
  if (raw === null) return INITIAL_VORONOI_STATE;
  const state = parseVoronoiState(raw);
  if (!state) console.warn("[voronoi-card] 存储里的布局无法解析，按初始布局画");
  return state ?? INITIAL_VORONOI_STATE;
}

function latestCells(usage: CodingUsagePayload): ShareCell[] {
  if (!usage.totals) throw new AwaitingReport("尚未收到 coding 用量");
  const cells = shareCells(usage.totals.totalTokens, usage.topModels);
  if (!cells.length) throw new AwaitingReport("coding 用量里还没有模型");
  return cells;
}

const LEGEND_X = 540;
const LEGEND_RIGHT = 752;
const SWATCH = 14;

const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function textColor(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#0b0f16" : "#ffffff";
}

export type VoronoiCardTotals = Pick<NonNullable<CodingUsagePayload["totals"]>, "totalTokens" | "apiEquivalentCostUSD" | "activeDays"> & {
  modelCount?: number;
};

export function renderVoronoiCard(fit: Fitted, totals: VoronoiCardTotals): string {
  const total = fit.cells.reduce((sum, c) => sum + c.tokens, 0);
  let cells = "";
  fit.layout.cells.forEach((layoutCell, i) => {
    const poly = fit.solved.polys[i];
    if (poly.length < 3) return;
    const { model, tokens } = fit.cells[i];
    const name = xml(model);
    const share = (tokens / total) * 100;
    const tc = textColor(layoutCell.color);
    const d = `M${poly.map((q) => `${q[0].toFixed(1)} ${q[1].toFixed(1)}`).join(" L")} Z`;
    cells += `<path d="${d}" fill="${layoutCell.color}" fill-opacity=".88" stroke="var(--bg)" stroke-width="2.5" stroke-linejoin="round"/>`;
    const label = fit.assessment.labels[i];
    if (!label.show) return;
    const [px, py] = label.at;
    if (label.nameSize) {
      cells += `<text x="${px.toFixed(1)}" y="${(py - 2).toFixed(1)}" text-anchor="middle" font-family="${CARD_MONO}" font-size="${label.nameSize}" font-weight="700" fill="${tc}">${name}</text>` +
        `<text x="${px.toFixed(1)}" y="${(py + 15).toFixed(1)}" text-anchor="middle" font-family="${CARD_MONO}" font-size="12" fill="${tc}" opacity=".75">${share.toFixed(1)}%</text>`;
    } else {
      cells += `<text x="${px.toFixed(1)}" y="${(py + 4).toFixed(1)}" text-anchor="middle" font-family="${CARD_MONO}" font-size="12" font-weight="700" fill="${tc}">${share.toFixed(1)}%</text>`;
    }
  });

  const order = fit.layout.cells
    .map((cell, i) => ({ cell, tokens: fit.cells[i].tokens }))
    .sort((a, b) => Number(a.cell.model === OTHER_MODEL) - Number(b.cell.model === OTHER_MODEL) || b.tokens - a.tokens);
  const pitch = order.length > 1 ? (MH - SWATCH) / (order.length - 1) : 0;
  const legend = order.map(({ cell, tokens }, i) => {
    const ty = MY + i * pitch, ly = ty + SWATCH - 2;
    return `<rect x="${LEGEND_X}" y="${ty.toFixed(1)}" width="${SWATCH}" height="${SWATCH}" rx="3" fill="${cell.color}" fill-opacity=".9"/>` +
      `<text x="${LEGEND_X + 22}" y="${ly.toFixed(1)}" font-size="14" fill="var(--fg)">${xml(cell.model)}</text>` +
      `<text x="${LEGEND_RIGHT}" y="${ly.toFixed(1)}" text-anchor="end" font-family="${CARD_MONO}" font-size="13" fill="var(--mute)">${formatTokens(tokens)}</text>`;
  }).join("");

  // 没有外框，左缘裁到 MX，内容和 README 正文左对齐；宽度与 /api/cards/week.svg 一致。
  const width = LEGEND_RIGHT - MX, height = MY + MH + 28;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MX} 0 ${width} ${height}" width="${width}" height="${height}" font-family="${CARD_FONT}" role="img" aria-label="Token usage ${formatTokens(totals.totalTokens)}, cost ${usd(totals.apiEquivalentCostUSD)}; area of each cell equals the model's share of tokens">` +
    cardStyle() +
    cardStat(0, "TOKEN", formatTokens(totals.totalTokens)) +
    cardStat(1, "COST", usd(totals.apiEquivalentCostUSD)) +
    // 存好的 coding 视图在下一次重建前还没有 modelCount，先画「—」，不拿前几名的个数顶替。
    cardStat(2, "MODELS", typeof totals.modelCount === "number" ? totals.modelCount.toLocaleString("en-US") : "—") +
    cardStat(3, "ACTIVE DAYS", totals.activeDays.toLocaleString("en-US")) +
    `<text x="${MX}" y="108" font-family="${CARD_MONO}" font-size="10" letter-spacing="3" fill="var(--mute)">AREA = SHARE OF TOKENS</text>` +
    `<clipPath id="map"><rect x="${MX}" y="${MY}" width="${MW}" height="${MH}"/></clipPath>` +
    `<g clip-path="url(#map)">${cells}</g>` +
    legend +
    "</svg>"
  );
}

// 请求端只从存好的布局出发做一次权重迭代（约几毫秒），从不做多种子搜索；要不要重排归定时任务。
export function voronoiCardResponse(): Promise<Response> {
  return cardResponse("voronoi-card", async () => {
    const [state, usage] = await Promise.all([loadState(), getCodingUsage()]);
    const cells = latestCells(usage);
    const totals = usage.totals as NonNullable<CodingUsagePayload["totals"]>;
    return renderVoronoiCard(fitLayout(state.layout, cells), totals);
  });
}

export async function voronoiCardRound(now = Date.now()): Promise<void> {
  const [state, usage] = await Promise.all([loadState(), getCodingUsage()]);
  const { state: next, changed, event } = relayoutRound(state, latestCells(usage), now);
  if (changed) await stateKey.put(next);
  if (event.kind === "relayout" || event.kind === "kept" || event.kind === "adapted") console.info("[voronoi-card]", JSON.stringify(event));
}
