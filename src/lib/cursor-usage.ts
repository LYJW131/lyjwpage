/**
 * Cursor 云端用量。容器上报器用已有的登录态拉历史，站点在读出口并进 Mac 的合计。
 *
 * 旧 Mac 把 Cursor 算进 totals 和年度图。容器再报一整份时不能再加一遍，
 * 只补 Mac 那行 `today` 之后的日子，锚定日按字段做差。
 * 新 Mac 用 `omittedSources: ["cursor"]` 声明合计里没有 Cursor，整份日桶另加。
 */

import { diffDays, zonedDay } from "./heatmap-window.ts";
import { object, text } from "./json.ts";
import { site } from "./site.ts";
import type { VibeCodingDay, VibeCodingUsageStatus } from "./types.ts";
import type { ParsedVibeCodingUsage } from "./vibecoding-parse.ts";
import { YEAR_DAYS } from "./vibecoding-year.ts";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 4_000;
const MAX_MODELS = 40;

export type CursorUsageDay = {
  date: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  apiEquivalentCostUSD: number;
  costComplete: boolean;
  models: Array<{ model: string; tokens: number }>;
};

export type ParsedCursorUsage = {
  collectedAt: string;
  state: "ok" | "error";
  error: string | null;
  coverageStart: string | null;
  coverageEnd: string | null;
  precision: "measured";
  costComplete: boolean;
  days: CursorUsageDay[];
};

type YearShape = {
  origin: string;
  days: number[];
  models: string[];
  mix: number[][];
};

function dayText(value: unknown): string | null {
  const date = text(value);
  if (!date || !DATE.test(date)) return null;
  const stamp = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(stamp) && new Date(stamp).toISOString().slice(0, 10) === date ? date : null;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function normalizeDay(value: unknown): CursorUsageDay | null {
  const row = object(value);
  if (!row) return null;
  const date = dayText(row.date);
  const inputTokens = count(row.inputTokens);
  const outputTokens = count(row.outputTokens);
  const cacheReadTokens = count(row.cacheReadTokens);
  const cacheCreationTokens = count(row.cacheCreationTokens);
  const totalTokens = count(row.totalTokens);
  if (!date || inputTokens == null || outputTokens == null || cacheReadTokens == null || cacheCreationTokens == null || totalTokens == null) {
    return null;
  }
  if (inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens !== totalTokens) return null;
  if (typeof row.apiEquivalentCostUSD !== "number" || !Number.isFinite(row.apiEquivalentCostUSD) || row.apiEquivalentCostUSD < 0) return null;
  if (typeof row.costComplete !== "boolean" || !Array.isArray(row.models) || row.models.length > MAX_MODELS) return null;
  const seen = new Set<string>();
  let modelTokens = 0;
  const models: CursorUsageDay["models"] = [];
  for (const entry of row.models) {
    const modelRow = object(entry);
    const model = modelRow ? text(modelRow.model) : null;
    const tokens = modelRow ? count(modelRow.tokens) : null;
    if (!model || model.length > 200 || tokens == null || tokens <= 0 || seen.has(model)) return null;
    seen.add(model);
    modelTokens += tokens;
    models.push({ model, tokens });
  }
  if (modelTokens > totalTokens) return null;
  return {
    date,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    totalTokens,
    apiEquivalentCostUSD: row.apiEquivalentCostUSD,
    costComplete: row.costComplete,
    models,
  };
}

export function normalizeCursorUsageReport(input: unknown): ParsedCursorUsage | null {
  const root = object(input);
  if (!root || !Array.isArray(root.days) || root.days.length > MAX_DAYS) return null;
  const collectedAt = text(root.collectedAt);
  if (!collectedAt || !Number.isFinite(Date.parse(collectedAt))) return null;
  if (root.state !== "ok" && root.state !== "error") return null;
  if (root.precision !== "measured" || typeof root.costComplete !== "boolean") return null;
  if (root.error != null && typeof root.error !== "string") return null;
  const coverageStart = dayText(root.coverageStart);
  const coverageEnd = dayText(root.coverageEnd);
  if (root.coverageStart != null && !coverageStart) return null;
  if (root.coverageEnd != null && !coverageEnd) return null;
  if (coverageStart && coverageEnd && coverageStart > coverageEnd) return null;
  const seen = new Set<string>();
  const days: CursorUsageDay[] = [];
  for (const value of root.days) {
    const day = normalizeDay(value);
    if (!day || seen.has(day.date)) return null;
    seen.add(day.date);
    days.push(day);
  }
  days.sort((left, right) => (left.date < right.date ? -1 : 1));
  return {
    collectedAt,
    state: root.state,
    error: text(root.error),
    coverageStart,
    coverageEnd,
    precision: "measured",
    costComplete: root.costComplete,
    days,
  };
}

function clamp(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.round(value), Number.MAX_SAFE_INTEGER);
}

function addCost(left: number, right: number): number {
  const sum = left + right;
  return Number.isFinite(sum) && sum > 0 ? sum : 0;
}

function toPublicDay(day: CursorUsageDay): VibeCodingDay {
  return {
    date: day.date,
    inputTokens: day.inputTokens,
    outputTokens: day.outputTokens,
    cacheReadTokens: day.cacheReadTokens,
    cacheCreationTokens: day.cacheCreationTokens,
    totalTokens: day.totalTokens,
    apiEquivalentCostUSD: day.apiEquivalentCostUSD,
  };
}

function statusOf(cursor: ParsedCursorUsage): VibeCodingUsageStatus {
  return {
    state: cursor.state,
    collectedAt: cursor.collectedAt,
    error: cursor.error,
    coverageStart: cursor.coverageStart,
    coverageEnd: cursor.coverageEnd,
    precision: cursor.precision,
    costComplete: cursor.costComplete,
  };
}

function todayOf(cursor: ParsedCursorUsage, now: number): VibeCodingDay | null {
  const date = zonedDay(now, site.timezone);
  const row = cursor.days.find((day) => day.date === date);
  if (row) return toPublicDay(row);
  if (cursor.coverageStart && cursor.coverageEnd && cursor.coverageStart <= date && date <= cursor.coverageEnd) {
    return {
      date,
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheCreationTokens: 0,
      totalTokens: 0,
      apiEquivalentCostUSD: 0,
    };
  }
  return null;
}

function rankedModels(days: CursorUsageDay[]): Array<{ model: string; tokens: number }> {
  const totals = new Map<string, number>();
  for (const day of days) {
    for (const model of day.models) totals.set(model.model, (totals.get(model.model) ?? 0) + model.tokens);
  }
  return [...totals]
    .filter(([, tokens]) => tokens > 0)
    .map(([model, tokens]) => ({ model, tokens }))
    .sort((left, right) => right.tokens - left.tokens || left.model.localeCompare(right.model));
}

type Contribution = {
  /** 要加进合计的差值。锚定日可以是负数。 */
  delta: CursorUsageDay;
  /** 这一天的模型拆分也要跟着加。锚定日拆分不在 Mac 合计里单列，不动。 */
  adjustModels: boolean;
  costComplete: boolean;
};

function deltaFrom(day: CursorUsageDay, base: VibeCodingDay | null): CursorUsageDay {
  return {
    ...day,
    models: day.models,
    inputTokens: day.inputTokens - (base?.inputTokens ?? 0),
    outputTokens: day.outputTokens - (base?.outputTokens ?? 0),
    cacheReadTokens: day.cacheReadTokens - (base?.cacheReadTokens ?? 0),
    cacheCreationTokens: day.cacheCreationTokens - (base?.cacheCreationTokens ?? 0),
    totalTokens: day.totalTokens - (base?.totalTokens ?? 0),
    apiEquivalentCostUSD: day.apiEquivalentCostUSD - (base?.apiEquivalentCostUSD ?? 0),
  };
}

function contributions(usage: ParsedVibeCodingUsage, cursor: ParsedCursorUsage): Contribution[] | null {
  if (usage.omittedSources?.includes("cursor")) {
    return cursor.days.map((day) => ({ delta: day, adjustModels: true, costComplete: day.costComplete }));
  }
  const mac = usage.agents.find((agent) => agent.id === "cursor");
  if (!mac) return null;
  const macCollected = mac.usageStatus.collectedAt ? Date.parse(mac.usageStatus.collectedAt) : null;
  if (macCollected != null && Date.parse(cursor.collectedAt) < macCollected) return null;
  const anchorDate = mac.today?.date ?? mac.usageStatus.coverageEnd;
  if (!anchorDate) return null;
  const rows: Contribution[] = [];
  for (const day of cursor.days) {
    if (day.date < anchorDate) continue;
    if (day.date === anchorDate) {
      if (!mac.today) continue;
      rows.push({ delta: deltaFrom(day, mac.today), adjustModels: false, costComplete: day.costComplete });
      continue;
    }
    rows.push({ delta: day, adjustModels: true, costComplete: day.costComplete });
  }
  return rows;
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

function overlayAgent(usage: ParsedVibeCodingUsage, cursor: ParsedCursorUsage, now: number): ParsedVibeCodingUsage["agents"] {
  const models = rankedModels(cursor.days);
  const next = {
    models: models.map((row) => row.model),
    topModel: models[0]?.model ?? null,
    today: todayOf(cursor, now),
    usageStatus: statusOf(cursor),
  };
  const agents = usage.agents.map((agent) => ({ ...agent, models: [...agent.models] }));
  const existing = agents.find((agent) => agent.id === "cursor");
  if (existing) {
    existing.models = next.models;
    existing.topModel = next.topModel;
    existing.today = next.today;
    existing.usageStatus = next.usageStatus;
    return agents;
  }
  if (!usage.omittedSources?.includes("cursor")) return agents;
  agents.push({
    id: "cursor",
    label: "Cursor",
    icon: "cursor",
    currentModel: null,
    ...next,
  });
  return agents;
}

/**
 * 读出口现算。不改镜像里的 Mac 原件：Mac 下一次上报自己会带上新的合计，
 * 这里的差是「容器比那封 Mac 更新的部分」。
 */
export function mergeCursorUsage<Year extends YearShape>(
  usage: ParsedVibeCodingUsage,
  cursor: ParsedCursorUsage | null,
  year: Year | null,
  now: number,
): { usage: ParsedVibeCodingUsage; year: Year | null } {
  if (!cursor) return { usage, year };
  const rows = contributions(usage, cursor);
  if (!rows) return { usage, year };
  const totals = { ...usage.totals };
  const top = new Map(usage.topModels.map((row) => [row.model, row.tokens]));
  const nextYear = year
    ? { ...year, days: [...year.days], models: [...year.models], mix: year.mix.map((row) => [...row]) }
    : null;
  const shares = nextYear ? decodeMix(nextYear) : null;
  for (const row of rows) {
    const { delta } = row;
    totals.inputTokens = clamp(totals.inputTokens + delta.inputTokens);
    totals.outputTokens = clamp(totals.outputTokens + delta.outputTokens);
    totals.cacheReadTokens = clamp(totals.cacheReadTokens + delta.cacheReadTokens);
    totals.cacheCreationTokens = clamp(totals.cacheCreationTokens + delta.cacheCreationTokens);
    totals.totalTokens = clamp(totals.totalTokens + delta.totalTokens);
    totals.apiEquivalentCostUSD = addCost(totals.apiEquivalentCostUSD, delta.apiEquivalentCostUSD);
    if (!row.costComplete) totals.costComplete = false;
    if (shares && nextYear) {
      const offset = diffDays(nextYear.origin, delta.date);
      if (offset >= 0 && offset < YEAR_DAYS && offset < nextYear.days.length) {
        const before = nextYear.days[offset] ?? 0;
        const after = clamp(before + delta.totalTokens);
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
  const collectedAt = Date.parse(cursor.collectedAt) > Date.parse(usage.collectedAt) ? cursor.collectedAt : usage.collectedAt;
  return {
    usage: {
      ...usage,
      agents: overlayAgent(usage, cursor, now),
      totals,
      topModels: [...top]
        .filter(([, tokens]) => tokens > 0)
        .map(([model, tokens]) => ({ model, tokens: clamp(tokens) }))
        .sort((left, right) => right.tokens - left.tokens || left.model.localeCompare(right.model))
        .slice(0, 3),
      collectedAt,
    },
    year: nextYear,
  };
}
