/**
 * 贡献日历的几何。格子 10px、间距 2px、起点 (27, 20)，53 周时画布 663×104，
 * 和从前 ghchart 那份对上，卡片宽度才不用改。
 *
 * SVG 用 geometricPrecision：卡片把 663 宽的 viewBox 拉到非整倍数时，
 * 格子按比例缩放，而不是各自对齐到像素把 2px 缝挤得忽宽忽窄。
 * （逐格 hover 之后一天就是一个 <rect>，不再按档位合并 path。）
 *
 * 空格子颜色交给 globals.css 的 `[data-score="0"] { fill: var(--muted) }`。
 */

import type { GithubChartDay } from "./types";

export const CELL = 10;
export const STEP = 12;
export const LEFT = 27;
export const TOP = 20;
/** 0 档的 #EEEEEE 会被 CSS 盖掉；其余四档保持原来的蓝。 */
export const FILLS = ["#EEEEEE", "#72b0ff", "#5896ff", "#2563eb", "#1e4fbc"] as const;
export const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const DAY_LABEL_Y = [28, 40, 52, 64, 77, 89, 101] as const;
export const VISIBLE_WEEKDAYS = new Set([1, 3, 5]);
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

export type ChartLabel = {
  x: number;
  y: number;
  fontSize: number;
  hidden: boolean;
  text: string;
};

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function sundayOf(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - day.getUTCDay());
  return day.toISOString().slice(0, 10);
}

export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function groupWeeks(days: GithubChartDay[]): GithubChartDay[][] {
  const weeks: GithubChartDay[][] = [];
  let current: GithubChartDay[] = [];
  let weekKey = "";
  for (const day of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
    const key = sundayOf(day.date);
    if (key !== weekKey) {
      if (current.length) weeks.push(current);
      current = [];
      weekKey = key;
    }
    current.push(day);
  }
  if (current.length) weeks.push(current);
  return weeks;
}

export function dayLabels(): ChartLabel[] {
  return DAY_NAMES.map((text, weekday) => ({
    x: 0,
    y: DAY_LABEL_Y[weekday] ?? 0,
    fontSize: 9,
    hidden: !VISIBLE_WEEKDAYS.has(weekday),
    text,
  }));
}

/**
 * 月份标在「这个月第一个周日」那一列。周中才换月的那一周仍算上个月，
 * 和 GitHub 资料页 thead 的 colspan 一致。
 */
export function monthLabels(weeks: GithubChartDay[][]): ChartLabel[] {
  const labels: ChartLabel[] = [];
  let lastMonth: string | null = null;
  weeks.forEach((week, index) => {
    const sunday = week.find((day) => day.weekday === 0) ?? week[0];
    if (!sunday) return;
    const month = sunday.date.slice(5, 7);
    if (month === lastMonth) return;
    lastMonth = month;
    const name = MONTHS[Number(month) - 1];
    if (!name) return;
    labels.push({
      x: LEFT + index * STEP,
      y: 10,
      fontSize: 10,
      hidden: false,
      text: name,
    });
  });
  return labels;
}

export function chartSize(weekCount: number) {
  return { width: LEFT + weekCount * STEP, height: TOP + 7 * STEP };
}

function ordinal(day: number): string {
  const rem100 = day % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${day}th`;
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

export function formatDayHeading(date: string): string {
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  return `${MONTH_NAMES[month - 1] ?? date.slice(5, 7)} ${ordinal(day)}`;
}

/** 和资料页格子 hover 同一句：`64 contributions on August 8th.` */
export function formatContributionLabel(date: string, count: number): string {
  const when = formatDayHeading(date);
  if (count <= 0) return `No contributions on ${when}.`;
  if (count === 1) return `1 contribution on ${when}.`;
  return `${count} contributions on ${when}.`;
}

/**
 * 把紧凑信封展开成格子要用的逐日对象。date / weekday / label 都是 origin
 * 和 count 的函数，不进 JSON。
 */
export function expandGithubDays(
  origin: string,
  counts: readonly number[],
  scores: readonly number[],
): GithubChartDay[] {
  if (!origin || counts.length === 0) return [];
  return counts.map((count, index) => {
    const date = addDays(origin, index);
    const raw = scores[index];
    const score = raw === 1 || raw === 2 || raw === 3 || raw === 4 ? raw : 0;
    return {
      date,
      weekday: weekdayOf(date),
      count,
      score,
      label: formatContributionLabel(date, count),
    };
  });
}
