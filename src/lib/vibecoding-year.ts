/**
 * `vibeCodingYear`：过去 53 周的日合计 token。
 *
 * 上报器和浏览器都按块走：一块 13 周，days 是从 from 起每天一个整数。
 * 站点只负责按 origin 拼成一条日历，格子上的档位和文案留给浏览器现算。
 */

import { weekdayOf } from "./github-chart-compact.ts";
import { number, object, text } from "./json.ts";
import type { VibeCodingYearChunk } from "./types.ts";

export const YEAR_WEEKS = 53;
export const CHUNK_WEEKS = 13;
export const YEAR_DAYS = YEAR_WEEKS * 7;
export const CHUNK_DAYS = CHUNK_WEEKS * 7;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

export function chunkLength(offset: number): number {
  const remaining = YEAR_DAYS - offset;
  if (remaining <= 0) return 0;
  return remaining <= CHUNK_DAYS * 2 ? remaining : CHUNK_DAYS;
}

export function chunkStarts(origin: string): string[] {
  const starts: string[] = [];
  for (let offset = 0; offset < YEAR_DAYS; ) {
    starts.push(addDays(origin, offset));
    offset += chunkLength(offset);
  }
  return starts;
}

export function sliceYearDays(days: number[], origin: string, from: string): number[] {
  const offset = Math.round(
    (Date.parse(`${from}T00:00:00Z`) - Date.parse(`${origin}T00:00:00Z`)) / 86_400_000,
  );
  if (!Number.isInteger(offset) || offset < 0 || offset >= days.length) return [];
  const length = chunkLength(offset);
  return days.slice(offset, offset + length);
}

function dateText(value: unknown): string | null {
  const parsed = text(value);
  if (!parsed || !DATE.test(parsed)) return null;
  return parsed;
}

/**
 * 一块是全有或全无的：origin / from 必须是周日，days 长度对得上从 from
 * 到窗口末的剩余天数（最多 13 周，最后一块可以更长到填满 53 周）。
 */
export function normalizeVibeCodingYear(input: unknown): VibeCodingYearChunk | null {
  const root = object(input);
  if (!root) return null;
  const origin = dateText(root.origin);
  const from = dateText(root.from);
  if (!origin || !from || weekdayOf(origin) !== 0 || weekdayOf(from) !== 0) return null;
  if (from < origin) return null;
  const offset = Math.round(
    (Date.parse(`${from}T00:00:00Z`) - Date.parse(`${origin}T00:00:00Z`)) / 86_400_000,
  );
  if (!Number.isInteger(offset) || offset < 0 || offset >= YEAR_DAYS) return null;
  if (offset % CHUNK_DAYS !== 0) return null;
  if (!Array.isArray(root.days)) return null;

  const expected = chunkLength(offset);
  if (expected <= 0 || root.days.length !== expected) return null;

  const days: number[] = [];
  for (const value of root.days) {
    const tokens = number(value);
    if (tokens == null || tokens < 0) return null;
    days.push(Math.round(tokens));
  }
  return { origin, from, days };
}

export function formatTokenLabel(date: string, tokens: number): string {
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const names = [
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
  ];
  const rem100 = day % 100;
  const ordinal =
    rem100 >= 11 && rem100 <= 13
      ? `${day}th`
      : day % 10 === 1
        ? `${day}st`
        : day % 10 === 2
          ? `${day}nd`
          : day % 10 === 3
            ? `${day}rd`
            : `${day}th`;
  const when = `${names[month - 1] ?? date.slice(5, 7)} ${ordinal}`;
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

/** 非零天的四分位，空格子永远是 0 档。 */
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

