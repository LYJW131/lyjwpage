import { AwaitingReport } from "@shared/awaiting-report";
import { object } from "@shared/json";
import { mirrorKey } from "@shared/storage";
import type { CodingUsagePayload } from "@shared/types";

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
  type HardIssue,
  type LayoutCell,
  type ShareCell,
} from "./voronoi-layout";
import { relayoutRound, type VoronoiState } from "./voronoi-relayout";
import { WEEK_CARD_CACHE_CONTROL } from "./week-card";

export const VORONOI_CARD_PATH = "/api/cards/voronoi.svg";
const VORONOI_CARD_FAILED_CACHE_CONTROL = "public, max-age=60";

const stateKey = mirrorKey<unknown>(["cards", "voronoi"]);

export const INITIAL_VORONOI_STATE: VoronoiState = {
  layout: INITIAL_VORONOI_LAYOUT,
  lastRelayoutAt: INITIAL_VORONOI_LAYOUT.chosenAt,
  lastFailedSearchAt: null,
  search: null,
};

const HARD_ISSUES: readonly HardIssue[] = ["area", "vanished", "short-edge", "span", "wedge", "label"];
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
  if (!layout.accepted.every((issue) => HARD_ISSUES.includes(issue as HardIssue))) return null;
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

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
const LEGEND_X = 540;
const LEGEND_RIGHT = 752;
const SWATCH = 14;

const fmt = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(2)}B` : `${(n / 1e6).toFixed(1)}M`);
const usd = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;
const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function textColor(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((k) => parseInt(hex.slice(k, k + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? "#0b0f16" : "#ffffff";
}

export function renderVoronoiCard(fit: Fitted, totals: { totalTokens: number; apiEquivalentCostUSD: number }): string {
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
      cells += `<text x="${px.toFixed(1)}" y="${(py - 2).toFixed(1)}" text-anchor="middle" font-family="${MONO}" font-size="${label.nameSize}" font-weight="700" fill="${tc}">${name}</text>` +
        `<text x="${px.toFixed(1)}" y="${(py + 15).toFixed(1)}" text-anchor="middle" font-family="${MONO}" font-size="12" fill="${tc}" opacity=".75">${share.toFixed(1)}%</text>`;
    } else {
      cells += `<text x="${px.toFixed(1)}" y="${(py + 4).toFixed(1)}" text-anchor="middle" font-family="${MONO}" font-size="12" font-weight="700" fill="${tc}">${share.toFixed(1)}%</text>`;
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
      `<text x="${LEGEND_RIGHT}" y="${ly.toFixed(1)}" text-anchor="end" font-family="${MONO}" font-size="13" fill="var(--mute)">${fmt(tokens)}</text>`;
  }).join("");

  // 没有外框，左缘裁到 MX，内容和 README 正文左对齐；宽度与 /api/cards/week.svg 一致。
  const width = LEGEND_RIGHT - MX, height = MY + MH + 28;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${MX} 0 ${width} ${height}" width="${width}" height="${height}" font-family="${FONT}" role="img" aria-label="Token usage ${fmt(totals.totalTokens)}, cost ${usd(totals.apiEquivalentCostUSD)}; area of each cell equals the model's share of tokens">` +
    "<style>:root{--bg:#ffffff;--fg:#1f2328;--mute:#656d76}@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--mute:#8b949e}}</style>" +
    `<text x="28" y="34" font-size="13" font-weight="600" letter-spacing="1.5" fill="var(--mute)">TOKEN</text>` +
    `<text x="28" y="76" font-size="34" font-weight="700" fill="var(--fg)">${fmt(totals.totalTokens)}</text>` +
    `<text x="218" y="34" font-size="13" font-weight="600" letter-spacing="1.5" fill="var(--mute)">COST</text>` +
    `<text x="218" y="76" font-size="34" font-weight="700" fill="var(--fg)">${usd(totals.apiEquivalentCostUSD)}</text>` +
    `<text x="${MX}" y="108" font-family="${MONO}" font-size="10" letter-spacing="3" fill="var(--mute)">AREA = SHARE OF TOKENS</text>` +
    `<clipPath id="map"><rect x="${MX}" y="${MY}" width="${MW}" height="${MH}"/></clipPath>` +
    `<g clip-path="url(#map)">${cells}</g>` +
    legend +
    "</svg>"
  );
}

// 请求端只从存好的布局出发做一次权重迭代（约几毫秒），从不做多种子搜索；要不要重排归定时任务。
export async function voronoiCardResponse(): Promise<Response> {
  try {
    const [state, usage] = await Promise.all([loadState(), getCodingUsage()]);
    const cells = latestCells(usage);
    const totals = usage.totals as NonNullable<CodingUsagePayload["totals"]>;
    const svg = renderVoronoiCard(fitLayout(state.layout, cells), totals);
    return new Response(svg, {
      headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": WEEK_CARD_CACHE_CONTROL },
    });
  } catch (error) {
    if (error instanceof AwaitingReport) console.warn("[voronoi-card]", error.message);
    else console.error("[voronoi-card]", error instanceof Error ? (error.stack ?? error.message) : String(error));
    return new Response("Voronoi card unavailable", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": VORONOI_CARD_FAILED_CACHE_CONTROL },
    });
  }
}

export async function voronoiCardRound(now = Date.now()): Promise<void> {
  const [state, usage] = await Promise.all([loadState(), getCodingUsage()]);
  const { state: next, changed, event } = relayoutRound(state, latestCells(usage), now);
  if (changed) await stateKey.put(next);
  if (event.kind === "relayout" || event.kind === "kept" || event.kind === "adapted") console.info("[voronoi-card]", JSON.stringify(event));
}
