/**
 * 把另存的日桶（Cursor 云端、Claude Code 云端线程）加进 Mac 那份用量合计和年度图。
 *
 * 读出口现算，不改镜像里的 Mac 原件。调用方负责决定每一天该加多少（差值还是整份），
 * 这里只管累加：totals、前三模型、年度格子、每日模型拆分、活跃天数。
 */

import { diffDays } from "./heatmap-window.ts";
import type { VibeCodingTotals } from "./types.ts";
import { YEAR_DAYS } from "./vibecoding-year.ts";

export type UsageDayDelta = {
  date: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  apiEquivalentCostUSD: number;
  models: Array<{ model: string; tokens: number }>;
};

export type UsageDayContribution = {
  /** 要加进合计的差值。锚定日可以是负数。 */
  delta: UsageDayDelta;
  /** 这一天的模型拆分也要跟着加。锚定日拆分不在 Mac 合计里单列，不动。 */
  adjustModels: boolean;
  costComplete: boolean;
};

export type YearShape = {
  origin: string;
  days: number[];
  models: string[];
  mix: number[][];
};

export function clampTokens(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.round(value), Number.MAX_SAFE_INTEGER);
}

function addCost(left: number, right: number): number {
  const sum = left + right;
  return Number.isFinite(sum) && sum > 0 ? sum : 0;
}

function decodeMix(year: YearShape): Map<number, Map<string, number>> {
  const shares = new Map<number, Map<string, number>>();
  for (const row of year.mix) {
    const offset = row[0];
    if (offset == null) continue;
    const models = new Map<string, number>();
    for (let index = 1; index + 1 < row.length; index += 2) {
      const modelIndex = row[index];
      const tokens = row[index + 1];
      const name = modelIndex == null ? undefined : year.models[modelIndex];
      if (name && tokens && tokens > 0) models.set(name, tokens);
    }
    shares.set(offset, models);
  }
  return shares;
}

function encodeMix(days: number[], shares: Map<number, Map<string, number>>): { models: string[]; mix: number[][] } {
  const ranked = new Map<number, Array<{ model: string; tokens: number }>>();
  const used = new Set<string>();
  for (const [offset, models] of shares) {
    const dayTotal = days[offset] ?? 0;
    if (dayTotal <= 0) continue;
    const rows = [...models]
      .filter(([, tokens]) => tokens > 0)
      .map(([model, tokens]) => ({ model, tokens }))
      .sort((left, right) => right.tokens - left.tokens || left.model.localeCompare(right.model))
      .slice(0, 5);
    let sum = rows.reduce((total, row) => total + row.tokens, 0);
    while (sum > dayTotal && rows.length > 0) {
      const last = rows[rows.length - 1];
      if (!last) break;
      const overflow = sum - dayTotal;
      if (last.tokens > overflow) {
        last.tokens -= overflow;
        sum = dayTotal;
      } else {
        sum -= last.tokens;
        rows.pop();
      }
    }
    const kept = rows.filter((row) => row.tokens > 0);
    if (kept.length === 0) continue;
    ranked.set(offset, kept);
    for (const row of kept) used.add(row.model);
  }
  const models = [...used].sort();
  const indexes = new Map(models.map((model, index) => [model, index]));
  const mix = [...ranked.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([offset, rows]) => {
      const encoded = [offset];
      for (const row of rows) encoded.push(indexes.get(row.model) ?? 0, row.tokens);
      return encoded;
    });
  return { models, mix };
}

export function addUsageDays<Year extends YearShape>(
  base: { totals: VibeCodingTotals; topModels: Array<{ model: string; tokens: number }> },
  rows: UsageDayContribution[],
  year: Year | null,
): { totals: VibeCodingTotals; topModels: Array<{ model: string; tokens: number }>; year: Year | null } {
  const totals = { ...base.totals };
  const top = new Map(base.topModels.map((row) => [row.model, row.tokens]));
  const nextYear = year
    ? { ...year, days: [...year.days], models: [...year.models], mix: year.mix.map((row) => [...row]) }
    : null;
  const shares = nextYear ? decodeMix(nextYear) : null;
  for (const row of rows) {
    const { delta } = row;
    totals.inputTokens = clampTokens(totals.inputTokens + delta.inputTokens);
    totals.outputTokens = clampTokens(totals.outputTokens + delta.outputTokens);
    totals.cacheReadTokens = clampTokens(totals.cacheReadTokens + delta.cacheReadTokens);
    totals.cacheCreationTokens = clampTokens(totals.cacheCreationTokens + delta.cacheCreationTokens);
    totals.totalTokens = clampTokens(totals.totalTokens + delta.totalTokens);
    totals.apiEquivalentCostUSD = addCost(totals.apiEquivalentCostUSD, delta.apiEquivalentCostUSD);
    if (!row.costComplete) totals.costComplete = false;
    if (shares && nextYear) {
      const offset = diffDays(nextYear.origin, delta.date);
      if (offset >= 0 && offset < YEAR_DAYS && offset < nextYear.days.length) {
        const before = nextYear.days[offset] ?? 0;
        const after = clampTokens(before + delta.totalTokens);
        nextYear.days[offset] = after;
        if (before <= 0 && after > 0) totals.activeDays += 1;
        if (before > 0 && after <= 0) totals.activeDays = Math.max(0, totals.activeDays - 1);
        if (row.adjustModels) {
          const models = shares.get(offset) ?? new Map<string, number>();
          for (const model of delta.models) models.set(model.model, (models.get(model.model) ?? 0) + model.tokens);
          shares.set(offset, models);
        }
      }
    }
    if (row.adjustModels) {
      for (const model of delta.models) top.set(model.model, (top.get(model.model) ?? 0) + model.tokens);
    }
  }
  if (nextYear && shares) {
    const encoded = encodeMix(nextYear.days, shares);
    nextYear.models = encoded.models;
    nextYear.mix = encoded.mix;
  }
  return {
    totals,
    topModels: [...top]
      .filter(([, tokens]) => tokens > 0)
      .map(([model, tokens]) => ({ model, tokens: clampTokens(tokens) }))
      .sort((left, right) => right.tokens - left.tokens || left.model.localeCompare(right.model))
      .slice(0, 3),
    year: nextYear,
  };
}
