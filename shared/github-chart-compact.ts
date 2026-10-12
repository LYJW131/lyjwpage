
import type { GithubChartDay } from "./types";

export const CELL = 10;
export const STEP = 12;
export const LEFT = 27;
export const TOP = 20;
// 须与 globals.css 里 .github-chart 的 data-score 档位数同步。
export const HEATMAP_LEVELS = 8;
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

export const HEATMAP_WEEKS = 53;

export function heatmapFrame(through: string): string[] {
  const dates: string[] = [];
  for (let date = addDays(sundayOf(through), -(HEATMAP_WEEKS - 1) * 7); date <= through; date = addDays(date, 1)) {
    dates.push(date);
  }
  return dates;
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
  const right = chartSize(weeks.length).width;
  return labels.map((label, index) => ({
    ...label,
    hidden: (labels[index + 1]?.x ?? right) - label.x < 2 * STEP,
  }));
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

export function formatContributionLabel(date: string, count: number): string {
  const when = formatDayHeading(date);
  if (count <= 0) return `No contributions on ${when}.`;
  if (count === 1) return `1 contribution on ${when}.`;
  return `${count} contributions on ${when}.`;
}

export function heatmapScores(counts: readonly number[]): number[] {
  const positive = counts.filter((value) => value > 0).sort((left, right) => left - right);
  if (positive.length === 0) return counts.map(() => 0);
  const max = positive.at(-1) ?? 0;
  return counts.map((value) => {
    if (value <= 0) return 0;
    if (value >= max) return HEATMAP_LEVELS;
    // 按严格小于它的天数定档：大量并列的最小值（如 1 个 commit）也落在最浅一档。
    let below = 0;
    let high = positive.length;
    while (below < high) {
      const mid = (below + high) >> 1;
      if ((positive[mid] ?? 0) < value) below = mid + 1;
      else high = mid;
    }
    return 1 + Math.floor((below / positive.length) * HEATMAP_LEVELS);
  });
}

export function expandGithubDays(origin: string, counts: readonly number[]): GithubChartDay[] {
  if (!origin || counts.length === 0) return [];
  const scores = heatmapScores(counts);
  return counts.map((count, index) => {
    const date = addDays(origin, index);
    const score = scores[index] ?? 0;
    return {
      date,
      weekday: weekdayOf(date),
      count,
      score,
      label: formatContributionLabel(date, count),
    };
  });
}
