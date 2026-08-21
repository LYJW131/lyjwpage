/**
 * `vibeCodingYear`：过去 53 周的日合计 token，外加每天前五的模型拆分。
 *
 * 整年一次给齐。`days[i]` 是 origin 起第 i 天的合计。档位、文案和 mix 展开
 * 都在浏览器现算。
 */

import { formatDayHeading, weekdayOf } from "./github-chart-compact.ts";
import { number, object, text } from "./json.ts";
import type { VibeCodingYearPayload } from "./types.ts";

export const YEAR_WEEKS = 53;
export const YEAR_DAYS = YEAR_WEEKS * 7;
export const YEAR_MIX_TOP = 5;
/** 格子浮层只画前三，信封仍可带最多五名。 */
export const YEAR_MIX_SHOW = 3;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type YearModelShare = { model: string; tokens: number };

export function addDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function dateText(value: unknown): string | null {
  const parsed = text(value);
  if (!parsed || !DATE.test(parsed)) return null;
  return parsed;
}

function intAtLeast(value: unknown, min: number): number | null {
  const parsed = number(value);
  if (parsed == null || parsed < min || !Number.isInteger(parsed)) return null;
  return parsed;
}

/**
 * 模型表 + 稀疏 offset 对。每天最多五名，下标必须能在表里对上，
 * 拆分合计不能超过那一天的 `days[offset]`。
 */
function normalizeMix(
  modelsValue: unknown,
  mixValue: unknown,
  days: number[],
): { models: string[]; mix: number[][] } | null {
  if (!Array.isArray(modelsValue) || !Array.isArray(mixValue)) return null;

  const models: string[] = [];
  const seen = new Set<string>();
  for (const value of modelsValue) {
    const name = text(value);
    if (!name || seen.has(name)) return null;
    seen.add(name);
    models.push(name);
  }

  const mix: number[][] = [];
  const usedOffsets = new Set<number>();
  const usedNames = new Set<number>();
  for (const row of mixValue) {
    if (!Array.isArray(row) || row.length < 3 || row.length % 2 === 0) return null;
    if (row.length > 1 + YEAR_MIX_TOP * 2) return null;
    const offset = intAtLeast(row[0], 0);
    if (offset == null || offset >= YEAR_DAYS || usedOffsets.has(offset)) return null;
    const dayTotal = days[offset] ?? 0;
    if (dayTotal <= 0) return null;
    usedOffsets.add(offset);

    const encoded = [offset];
    const usedIdx = new Set<number>();
    let mixTotal = 0;
    for (let index = 1; index < row.length; index += 2) {
      const modelIndex = intAtLeast(row[index], 0);
      const tokens = intAtLeast(row[index + 1], 1);
      if (modelIndex == null || tokens == null || modelIndex >= models.length) return null;
      if (usedIdx.has(modelIndex)) return null;
      usedIdx.add(modelIndex);
      usedNames.add(modelIndex);
      mixTotal += tokens;
      encoded.push(modelIndex, tokens);
    }
    if (mixTotal > dayTotal) return null;
    mix.push(encoded);
  }

  if (usedNames.size !== models.length) return null;
  return { models, mix };
}

/**
 * 整份是全有或全无的：origin 必须是周日，days 必须正好 53 周，mix 必须能对上。
 */
export function normalizeVibeCodingYear(
  input: unknown,
): Omit<VibeCodingYearPayload, "pushedAt"> | null {
  const root = object(input);
  if (!root) return null;
  const origin = dateText(root.origin);
  if (!origin || weekdayOf(origin) !== 0) return null;
  if (!Array.isArray(root.days) || root.days.length !== YEAR_DAYS) return null;

  const days: number[] = [];
  for (const value of root.days) {
    const tokens = number(value);
    if (tokens == null || tokens < 0) return null;
    days.push(Math.round(tokens));
  }
  const mix = normalizeMix(root.models, root.mix, days);
  if (!mix) return null;
  return { origin, days, models: mix.models, mix: mix.mix };
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
