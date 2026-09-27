/**
 * Cursor 云端用量。容器上报器用已有的登录态拉历史，站点在读出口并进 Mac 的合计。
 *
 * 旧 Mac 把 Cursor 算进 totals 和年度图。容器再报一整份时不能再加一遍，
 * 只补 Mac 那行 `today` 之后的日子，锚定日按字段做差。
 * 新 Mac 用 `omittedSources: ["cursor"]` 声明合计里没有 Cursor，整份日桶另加。
 */

import { zonedDay } from "./heatmap-window.ts";
import { object, text } from "./json.ts";
import { site } from "./site.ts";
import type { VibeCodingDay, VibeCodingUsageStatus } from "./types.ts";
import { addUsageDays, type UsageDayContribution, type YearShape } from "./usage-day-merge.ts";
import type { ParsedVibeCodingUsage } from "./vibecoding-parse.ts";

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
  /** 采到了但有缺口（部分请求没有 token 数、云端历史变短……），state 仍为 ok */
  warning: string | null;
  coverageStart: string | null;
  coverageEnd: string | null;
  precision: "measured";
  costComplete: boolean;
  days: CursorUsageDay[];
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
  if (root.warning != null && typeof root.warning !== "string") return null;
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
    warning: text(root.warning),
    coverageStart,
    coverageEnd,
    precision: "measured",
    costComplete: root.costComplete,
    days,
  };
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
    warning: cursor.warning,
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

/**
 * 最近一个有用量的日子里用得最多的模型。Cursor 没有会话级的「此刻在用哪个」，
 * 跟 MacTelemetryHub 的 fallbackModel 同一个口径：闲置时显示最近在用的模型。
 */
function latestModel(days: CursorUsageDay[]): string | null {
  for (let index = days.length - 1; index >= 0; index -= 1) {
    const top = days[index]?.models.reduce<CursorUsageDay["models"][number] | null>(
      (best, row) => (best == null || row.tokens > best.tokens ? row : best),
      null,
    );
    if (top) return top.model;
  }
  return null;
}

type Contribution = UsageDayContribution;

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

function overlayAgent(usage: ParsedVibeCodingUsage, cursor: ParsedCursorUsage, now: number): ParsedVibeCodingUsage["agents"] {
  const models = rankedModels(cursor.days);
  const currentModel = latestModel(cursor.days);
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
    existing.currentModel = currentModel ?? existing.currentModel;
    return agents;
  }
  if (!usage.omittedSources?.includes("cursor")) return agents;
  agents.push({
    id: "cursor",
    label: "Cursor",
    icon: "cursor",
    currentModel,
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
  const merged = addUsageDays(usage, rows, year);
  const collectedAt = Date.parse(cursor.collectedAt) > Date.parse(usage.collectedAt) ? cursor.collectedAt : usage.collectedAt;
  return {
    usage: {
      ...usage,
      agents: overlayAgent(usage, cursor, now),
      totals: merged.totals,
      topModels: merged.topModels,
      collectedAt,
    },
    year: merged.year,
  };
}
