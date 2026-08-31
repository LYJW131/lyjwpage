/**
 * `vibeCodingYear`：过去 53 周的日合计 token，外加每天前五的模型拆分。
 *
 * 整年一次给齐。`days[i]` 是 origin 起第 i 天的合计。档位、文案和 mix 展开
 * 都在浏览器现算。
 */

import { addDays, formatDayHeading, weekdayOf } from "./github-chart-compact.ts";
import {
  diffDays,
  heatmapSliceFrom,
  mergeHeatmapSeries,
  sliceHeatmapWindow,
  zonedDay,
} from "./heatmap-window.ts";
import { number, object, text } from "./json.ts";
import { site } from "./site.ts";
import type { StoredVibeCodingYear, VibeCodingYearPayload } from "./types.ts";

export const YEAR_WEEKS = 53;
export const YEAR_DAYS = YEAR_WEEKS * 7;
export const YEAR_MIX_TOP = 5;
/** 格子浮层只画前三，信封仍可带最多五名。 */
export const YEAR_MIX_SHOW = 3;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export type YearModelShare = { model: string; tokens: number };

export { addDays };

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
): Omit<StoredVibeCodingYear, "pushedAt"> | null {
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

/**
 * 在取数出口盖一次「源站此刻是哪一天」。
 *
 * 和 withActivityFreshness 同一套口径：这是唯一一个光靠时间流逝就会翻面的结论，
 * 冻在缓存里那份最多旧 10 分钟（见 lib/status-cache），端点每次请求现算。
 *
 * 用站点时区而不是 UTC：日合计是采集侧按自己的日历分的桶，切窗必须用同一份日历，
 * 理由见 heatmap-window 的 zonedDay。
 */
export function withYearFreshness(
  payload: StoredVibeCodingYear,
  now = Date.now(),
): VibeCodingYearPayload {
  return { ...payload, todayAtSource: zonedDay(now, site.timezone) };
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

/** 按客户端最后一天切窗尾。mix 只留这段里的行，模型表收成这段用到的名字。 */
export function sliceVibeCodingYear(
  payload: VibeCodingYearPayload,
  since?: string,
): VibeCodingYearPayload {
  const { partial, fromIndex } = sliceHeatmapWindow(
    payload.origin,
    payload.days.length,
    since,
  );
  if (!partial) {
    return {
      origin: payload.origin,
      days: payload.days,
      models: payload.models,
      mix: payload.mix,
      pushedAt: payload.pushedAt,
      todayAtSource: payload.todayAtSource,
    };
  }
  const mix = compactMix(
    payload.models,
    payload.mix.filter((row) => (row[0] ?? 0) >= fromIndex),
  );
  return {
    origin: payload.origin,
    days: payload.days.slice(fromIndex),
    models: mix.models,
    mix: mix.mix,
    pushedAt: payload.pushedAt,
    todayAtSource: payload.todayAtSource,
    daysPartial: true,
    from: heatmapSliceFrom(payload.origin, fromIndex),
  };
}

/**
 * 把增量并回整年。原点前滚时 mix 的 offset 跟着减；模型表按名字并上，
 * 两边的下标都重新对。
 */
export function mergeVibeCodingYear(
  local: VibeCodingYearPayload | null,
  incoming: VibeCodingYearPayload,
): VibeCodingYearPayload {
  if (!incoming.daysPartial || !local?.days.length) {
    return stripYearPartial(incoming);
  }

  const days = mergeHeatmapSeries(local.days, local.origin, {
    origin: incoming.origin,
    from: incoming.from,
    values: incoming.days,
    partial: true,
  }).values;
  const fromIndex = incoming.from
    ? Math.max(0, diffDays(incoming.origin, incoming.from))
    : 0;
  const models = unionModels(local.models, incoming.models);
  const delta = diffDays(local.origin, incoming.origin);
  const incomingOffsets = new Set(incoming.mix.map((row) => row[0]));
  const kept = shiftMix(local.mix, delta)
    .map((row) => remapMixRow(row, local.models, models))
    .filter((row): row is number[] => row != null && row[0] < fromIndex && !incomingOffsets.has(row[0]));
  const incomingMix = incoming.mix
    .map((row) => remapMixRow(row, incoming.models, models))
    .filter((row): row is number[] => row != null);
  return {
    origin: incoming.origin,
    days,
    models,
    mix: [...kept, ...incomingMix],
    pushedAt: incoming.pushedAt,
    todayAtSource: incoming.todayAtSource,
  };
}

function stripYearPartial(payload: VibeCodingYearPayload): VibeCodingYearPayload {
  return {
    origin: payload.origin,
    days: payload.days.slice(),
    models: payload.models.slice(),
    mix: payload.mix.map((row) => row.slice()),
    pushedAt: payload.pushedAt,
    todayAtSource: payload.todayAtSource,
  };
}

function shiftMix(mix: number[][], delta: number): number[][] {
  if (delta === 0) return mix.map((row) => row.slice());
  const shifted: number[][] = [];
  for (const row of mix) {
    const offset = (row[0] ?? 0) - delta;
    if (offset < 0) continue;
    shifted.push([offset, ...row.slice(1)]);
  }
  return shifted;
}

function compactMix(
  models: string[],
  mix: number[][],
): { models: string[]; mix: number[][] } {
  const used: string[] = [];
  const indexOf = new Map<string, number>();
  const next: number[][] = [];
  for (const row of mix) {
    const encoded = [row[0] ?? 0];
    for (let index = 1; index + 1 < row.length; index += 2) {
      const name = models[row[index] ?? -1];
      const tokens = row[index + 1];
      if (!name || tokens == null) continue;
      let modelIndex = indexOf.get(name);
      if (modelIndex == null) {
        modelIndex = used.length;
        indexOf.set(name, modelIndex);
        used.push(name);
      }
      encoded.push(modelIndex, tokens);
    }
    if (encoded.length >= 3) next.push(encoded);
  }
  return { models: used, mix: next };
}

function unionModels(local: string[], incoming: string[]): string[] {
  const models = local.slice();
  const seen = new Set(local);
  for (const name of incoming) {
    if (seen.has(name)) continue;
    seen.add(name);
    models.push(name);
  }
  return models;
}

function remapMixRow(
  row: number[],
  fromModels: string[],
  toModels: string[],
): number[] | null {
  const offset = row[0];
  if (offset == null) return null;
  const next = [offset];
  for (let index = 1; index + 1 < row.length; index += 2) {
    const name = fromModels[row[index] ?? -1];
    const tokens = row[index + 1];
    if (!name || tokens == null) continue;
    const modelIndex = toModels.indexOf(name);
    if (modelIndex < 0) continue;
    next.push(modelIndex, tokens);
  }
  return next.length >= 3 ? next : null;
}
