
import { addDays, formatDayHeading, sundayOf, weekdayOf } from "./github-chart-compact.ts";
import { zonedDay } from "./heatmap-window.ts";
import { site } from "./site.ts";
import type { CodingYearPayload } from "./types.ts";

export const YEAR_WEEKS = 53;
export const YEAR_DAYS = YEAR_WEEKS * 7;
export const YEAR_MIX_SHOW = 3;

export type YearModelShare = { model: string; tokens: number };

export type CodingYearDay = { tokens: number; models: ReadonlyArray<readonly [model: string, tokens: number]> };

export { addDays };

export function encodeCodingYear(
  year: { updatedAt: number; days: Readonly<Record<string, CodingYearDay>> },
  now: number,
): CodingYearPayload {
  const today = zonedDay(now, site.timezone);
  const origin = addDays(sundayOf(today), -(YEAR_WEEKS - 1) * 7);
  const models: string[] = [];
  const index = new Map<string, number>();
  const days: number[] = [];
  const mix: number[][] = [];
  for (let offset = 0; offset < YEAR_DAYS; offset += 1) {
    const day = year.days[addDays(origin, offset)];
    days.push(day?.tokens ?? 0);
    if (!day?.tokens || !day.models.length) continue;
    const row = [offset];
    for (const [model, tokens] of day.models) {
      if (!index.has(model)) {
        index.set(model, models.length);
        models.push(model);
      }
      row.push(index.get(model)!, tokens);
    }
    mix.push(row);
  }
  return { origin, days, models, mix, updatedAt: year.updatedAt, todayAtSource: today };
}

export function indexYearMix(
  models: string[],
  mix: number[][],
): Map<number, YearModelShare[]> {
  const byOffset = new Map<number, YearModelShare[]>();
  for (const row of mix) {
    const offset = row[0];
    if (offset == null) continue;
    const parts: YearModelShare[] = [];
    for (let index = 1; index + 1 < row.length; index += 2) {
      const modelIndex = row[index];
      const tokens = row[index + 1];
      const name = modelIndex == null ? undefined : models[modelIndex];
      if (!name || tokens == null || tokens <= 0) continue;
      parts.push({ model: name, tokens });
    }
    if (parts.length) byOffset.set(offset, parts);
  }
  return byOffset;
}

export function formatTokenLabel(date: string, tokens: number): string {
  const when = formatDayHeading(date);
  if (tokens <= 0) return `No tokens on ${when}.`;
  return `${compactTokens(tokens)} tokens on ${when}.`;
}

export function compactTokens(tokens: number): string {
  if (tokens < 1_000) return String(Math.round(tokens));
  if (tokens < 1_000_000) {
    const value = tokens / 1_000;
    return `${value >= 10 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, "")}k`;
  }
  const value = tokens / 1_000_000;
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1).replace(/\.0$/, "")}M`;
}

export function tokenScores(counts: number[]): Array<0 | 1 | 2 | 3 | 4> {
  const positive = counts.filter((value) => value > 0).sort((left, right) => left - right);
  if (positive.length === 0) return counts.map(() => 0);
  const at = (percentile: number) => {
    const index = Math.min(
      positive.length - 1,
      Math.max(0, Math.ceil(percentile * positive.length) - 1),
    );
    return positive[index] ?? 0;
  };
  const q1 = at(0.25);
  const q2 = at(0.5);
  const q3 = at(0.75);
  return counts.map((value) => {
    if (value <= 0) return 0;
    if (value <= q1) return 1;
    if (value <= q2) return 2;
    if (value <= q3) return 3;
    return 4;
  });
}

export function expandYearDays(origin: string, days: number[]) {
  return days.map((tokens, index) => {
    const date = addDays(origin, index);
    return { date, tokens, weekday: weekdayOf(date) };
  });
}
