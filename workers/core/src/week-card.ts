import { AwaitingReport } from "@shared/awaiting-report";
import { getGithubChart } from "@shared/github-chart";
import type { CodingUsageTotals, CodingYearPayload, GithubChartPayload } from "@shared/types";

import { getCodingUsage, getCodingYear } from "./coding-usage";

export const WEEK_CARD_PATH = "/api/cards/week.svg";

// GitHub README 的图片经 camo 代理，camo 按这个头缓存；数字按天变，十分钟足够新，又不让每次浏览都唤醒 StateHub。
export const WEEK_CARD_CACHE_CONTROL = "public, max-age=600, stale-while-revalidate=3600";
const WEEK_CARD_FAILED_CACHE_CONTROL = "public, max-age=60";

const DAY_MS = 86_400_000;

export type WeekCardStats = {
  dates: string[];
  tokens: number[];
  commits: number[];
  tokenAvgAllTime: number;
  commitAvgAllTime: number;
};

export type WeekCardCopy = {
  weekTokens: string;
  todayTokens: string;
  weekCommits: string;
  todayCommits: string;
  vsAllTime: string;
  vsWeek: string;
  today: string;
};

export const WEEK_CARD_COPY: WeekCardCopy = {
  weekTokens: "7D TOKENS",
  todayTokens: "TODAY",
  weekCommits: "7D COMMITS",
  todayCommits: "TODAY",
  vsAllTime: "avg",
  vsWeek: "vs 7d",
  today: "Today",
};

const dayOf = (date: string) => Date.parse(`${date}T00:00:00Z`);
const isoOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

// 前 7 天加今天共 8 天；今天按源站时区（todayAtSource）定，两份数据各按自己的 origin 对齐日期。
export function weekCardStats(
  year: CodingYearPayload,
  totals: Pick<CodingUsageTotals, "totalTokens" | "activeDays"> | null,
  chart: GithubChartPayload,
): WeekCardStats {
  const today = dayOf(year.todayAtSource);
  const dates = Array.from({ length: 8 }, (_, i) => isoOf(today + (i - 7) * DAY_MS));
  const at = (origin: string, values: number[], date: string) => {
    const index = Math.round((dayOf(date) - dayOf(origin)) / DAY_MS);
    return values[index] ?? 0;
  };
  const activeCommitDays = chart.counts.filter((count) => count > 0).length;
  const commitTotal = chart.counts.reduce((sum, count) => sum + count, 0);
  return {
    dates,
    tokens: dates.map((date) => at(year.origin, year.days, date)),
    commits: dates.map((date) => at(chart.origin, chart.counts, date)),
    tokenAvgAllTime: totals && totals.activeDays > 0 ? totals.totalTokens / totals.activeDays : 0,
    commitAvgAllTime: activeCommitDays > 0 ? commitTotal / activeCommitDays : 0,
  };
}

export function formatTokens(value: number): string {
  if (value >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return String(Math.round(value));
}

// 单调三次插值（Fritsch–Carlson）：曲线不冲出相邻两点的范围，零用量的日子不会画到基线以下。
export function monotonePath(xs: number[], ys: number[]): string {
  const n = xs.length;
  if (n < 2) return n ? `M${xs[0]},${ys[0]}` : "";
  const dx: number[] = [];
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx[i] = xs[i + 1] - xs[i];
    slope[i] = (ys[i + 1] - ys[i]) / dx[i];
  }
  const tangent = new Array<number>(n).fill(0);
  tangent[0] = slope[0];
  tangent[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) tangent[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      tangent[i] = 0;
      tangent[i + 1] = 0;
      continue;
    }
    const a = tangent[i] / slope[i];
    const b = tangent[i + 1] / slope[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      tangent[i] = k * a * slope[i];
      tangent[i + 1] = k * b * slope[i];
    }
  }
  const r = (v: number) => Number(v.toFixed(1));
  let d = `M${r(xs[0])},${r(ys[0])}`;
  for (let i = 0; i < n - 1; i++) {
    d += ` C${r(xs[i] + dx[i] / 3)},${r(ys[i] + (tangent[i] * dx[i]) / 3)} ${r(xs[i + 1] - dx[i] / 3)},${r(ys[i + 1] - (tangent[i + 1] * dx[i]) / 3)} ${r(xs[i + 1])},${r(ys[i + 1])}`;
  }
  return d;
}

// 宽度与 LYJW131 README 里的 Voronoi 卡一致：width 724、viewBox 左缘 28，内容占满 x=28..752。
const X0 = 28;
const WIDTH = 724;
const HEIGHT = 262;
const BAR_W = 73;
const BAR_GAP = 20;
const BAR_TOP = 160;
const BAR_H = 72;
const STAT_PITCH = 2 * (BAR_W + BAR_GAP);

const FONT = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const MONO = "ui-monospace,SFMono-Regular,Menlo,Consolas,monospace";
const STYLE =
  "<style>:root{--bg:#ffffff;--fg:#1f2328;--mute:#656d76;--line:#1f2328;--bar:#d0d7de;--up:#cf222e;--down:#1a7f37}" +
  "@media (prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--mute:#8b949e;--line:#e6edf3;--bar:#3d444d;--up:#ff7b72;--down:#3fb950}}</style>";

function delta(change: number, value: string, tail: string) {
  const up = change >= 0;
  return `<tspan fill="var(--${up ? "up" : "down"})">${up ? "▲" : "▼"} ${value}</tspan> <tspan font-weight="400" fill="var(--mute)">${tail}</tspan>`;
}

function stat(column: number, label: string, value: string, compare: string) {
  const x = X0 + column * STAT_PITCH;
  return (
    `<text x="${x}" y="34" font-size="13" font-weight="600" letter-spacing="1.5" fill="var(--mute)">${label}</text>` +
    `<text x="${x}" y="76" font-size="34" font-weight="700" fill="var(--fg)">${value}</text>` +
    `<text x="${x}" y="98" font-size="13" font-weight="600">${compare}</text>`
  );
}

export function renderWeekCard(stats: WeekCardStats, copy: WeekCardCopy = WEEK_CARD_COPY): string {
  const { tokens, commits } = stats;
  const weekTokens = tokens.slice(0, 7).reduce((sum, v) => sum + v, 0);
  const weekCommits = commits.slice(0, 7).reduce((sum, v) => sum + v, 0);
  const todayTokens = tokens[7];
  const todayCommits = commits[7];
  const tokenAvg = weekTokens / 7;
  const commitAvg = weekCommits / 7;
  const tokenMultiple = stats.tokenAvgAllTime > 0 ? tokenAvg / stats.tokenAvgAllTime : 0;
  const commitMultiple = stats.commitAvgAllTime > 0 ? commitAvg / stats.commitAvgAllTime : 0;
  const tokenPct = tokenAvg > 0 ? Math.round((todayTokens / tokenAvg - 1) * 100) : 0;
  const commitPct = commitAvg > 0 ? Math.round((todayCommits / commitAvg - 1) * 100) : 0;

  const cx = (i: number) => X0 + i * (BAR_W + BAR_GAP) + BAR_W / 2;
  const tokenMax = Math.max(...tokens, 1);
  const commitMax = Math.max(...commits, 1);
  const xs = tokens.map((_, i) => cx(i));
  const ys = tokens.map((v) => BAR_TOP + BAR_H - (v / tokenMax) * BAR_H);

  const bars = commits
    .map((v, i) => {
      const h = Math.max(2, (v / commitMax) * BAR_H);
      return `<rect x="${X0 + i * (BAR_W + BAR_GAP)}" y="${(BAR_TOP + BAR_H - h).toFixed(1)}" width="${BAR_W}" height="${h.toFixed(1)}" fill="var(--bar)"/>`;
    })
    .join("");
  const peakBar = commits.indexOf(Math.max(...commits));
  const barLabel = Math.max(...commits) > 0
    ? `<text x="${cx(peakBar)}" y="${BAR_TOP + BAR_H / 2 + 14}" font-family="${MONO}" font-size="12" font-weight="600" text-anchor="middle" fill="var(--fg)">${commits[peakBar].toLocaleString("en-US")}</text>`
    : "";
  const peakPoint = tokens.indexOf(Math.max(...tokens));
  const dots = xs
    .map((x, i) =>
      i === peakPoint && tokens[i] > 0
        ? `<circle cx="${x}" cy="${ys[i].toFixed(1)}" r="4" fill="var(--line)"/><text x="${x}" y="${(ys[i] - 10).toFixed(1)}" font-size="12" font-weight="600" text-anchor="middle" fill="var(--fg)">${formatTokens(tokens[i])}</text>`
        : `<circle cx="${x}" cy="${ys[i].toFixed(1)}" r="2.5" fill="var(--bg)" stroke="var(--line)" stroke-width="1.5"/>`,
    )
    .join("");
  const labels = stats.dates
    .map((date, i) => `<text x="${cx(i)}" y="${BAR_TOP + BAR_H + 15}" font-size="10" text-anchor="middle" fill="var(--mute)">${i === 7 ? copy.today : Number(date.slice(8))}</text>`)
    .join("");

  const aria = `Last 7 days: ${formatTokens(weekTokens)} tokens, ${weekCommits.toLocaleString("en-US")} commits`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="${X0} 0 ${WIDTH} ${HEIGHT}" font-family="${FONT}" role="img" aria-label="${aria}">` +
    STYLE +
    stat(0, copy.weekTokens, formatTokens(weekTokens), delta(tokenMultiple - 1, `${tokenMultiple.toFixed(1)}×`, copy.vsAllTime)) +
    stat(1, copy.todayTokens, formatTokens(todayTokens), delta(tokenPct, `${Math.abs(tokenPct)}%`, copy.vsWeek)) +
    stat(2, copy.weekCommits, weekCommits.toLocaleString("en-US"), delta(commitMultiple - 1, `${commitMultiple.toFixed(1)}×`, copy.vsAllTime)) +
    stat(3, copy.todayCommits, todayCommits.toLocaleString("en-US"), delta(commitPct, `${Math.abs(commitPct)}%`, copy.vsWeek)) +
    bars +
    barLabel +
    `<path d="${monotonePath(xs, ys)}" fill="none" stroke="var(--line)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>` +
    dots +
    labels +
    "</svg>"
  );
}

export async function weekCardResponse(): Promise<Response> {
  try {
    const [year, usage, chart] = await Promise.all([getCodingYear(), getCodingUsage(), getGithubChart()]);
    const svg = renderWeekCard(weekCardStats(year, usage.totals, chart.data));
    return new Response(svg, {
      headers: { "Content-Type": "image/svg+xml; charset=utf-8", "Cache-Control": WEEK_CARD_CACHE_CONTROL },
    });
  } catch (error) {
    if (error instanceof AwaitingReport) console.warn("[week-card]", error.message);
    else console.error("[week-card]", error instanceof Error ? (error.stack ?? error.message) : String(error));
    return new Response("Week card unavailable", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": WEEK_CARD_FAILED_CACHE_CONTROL },
    });
  }
}
