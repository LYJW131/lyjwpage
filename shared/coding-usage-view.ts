import { zonedDay } from "@/lib/heatmap-window";
import { site } from "@/lib/site";
import type {
  CodingNowPayload,
  CodingUsageAgentView,
  CodingUsageDayTotals,
  CodingUsagePayload,
  CodingUsageSourceStatus,
  CodingUsageTotals,
} from "@/lib/types";

import { isVisibleCodingModel } from "./coding-models";
import type { CodingUsageAgent, CodingUsageDay } from "./coding-usage";
import {
  CODING_USAGE_SOURCE_NAMES,
  resolveCodingUsageSources,
  type CodingUsageSource,
} from "./coding-usage-sources";

/**
 * coding 用量视图：状态核心在同一次提交里由各来源的账本算出，存一份，读出口原样给。
 *
 * **全历史的聚合写时算，和钟有关的切片读时算**：合计、排名、各 agent 最近一个有行的日子、
 * 每天的模型拆分在这里；「那一天是不是今天」（浏览器）和年度窗口从哪天起（读出口按站点今天切）
 * 不在这里。只有账本真的变了才重算。
 */

/**
 * `coding:usage:<来源>` 的一格（字段 = agent id）：这个来源最后一次报来的这个 agent 的账本。
 * `state: "error"` 那一轮只换状态，日子沿用上一份（从没成功过就是空数组）。
 */
export type StoredCodingUsageAgent = Omit<CodingUsageAgent, "days"> & {
  days: CodingUsageDay[];
  /** 状态核心收到这份日子的时刻；只换状态不动它 */
  receivedAt: number;
  /** 日子（或会话数）最近一次变化时的 `coding:usage:revision`；只换状态不动它。D1 归档按它取增量，没有按 0 */
  revision?: number;
};

/** 全部来源的账本：来源 → agent id → 账本 */
export type StoredCodingUsage = Partial<Record<CodingUsageSource, Record<string, StoredCodingUsageAgent>>>;

/**
 * `coding:usage:year`：最近 `CODING_YEAR_KEEP_DAYS` 个站点日每天的合计与精确的模型前五。
 * 读出口按站点今天切出 53 周、编码成 `CodingYearPayload` 的 `days/models/mix`。
 */
export type CodingUsageYearView = {
  updatedAt: number;
  /** 站点日 → 那一天的合计与前五模型（`[模型, tokens]`，按 tokens 降序）；没有用量的日子不出现 */
  days: Record<string, { tokens: number; models: Array<[model: string, tokens: number]> }>;
};

/** 一次重算的产物：公开视图（`coding:usage:view`）与年度视图（`coding:usage:year`） */
export type CodingUsageViews = { view: CodingUsagePayload; year: CodingUsageYearView };

/** 全部历史的前几名模型 */
export const CODING_TOP_MODELS = 3;
/** 每个 agent 自己的模型名单最多留几个 */
export const CODING_AGENT_MODELS = 20;
/** 年度视图留几天：53 周是 371 天，多留几天给站点今天往前挪的余量 */
export const CODING_YEAR_KEEP_DAYS = 380;
/** 年度格子每天留前几名模型 */
export const CODING_YEAR_TOP_MODELS = 5;

const DAY_MS = 86_400_000;

type DayTotals = {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  apiEquivalentCostUSD: number;
  /** 这一天所有有 token 的行都估全了价；没有 token 的行不拉低它 */
  costComplete: boolean;
  models: Map<string, number>;
};

function emptyTotals(): DayTotals {
  return {
    inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0,
    totalTokens: 0, apiEquivalentCostUSD: 0, costComplete: true, models: new Map(),
  };
}

function addDay(into: DayTotals, day: CodingUsageDay): void {
  into.inputTokens += day.inputTokens;
  into.outputTokens += day.outputTokens;
  into.cacheReadTokens += day.cacheReadTokens;
  into.cacheCreationTokens += day.cacheCreationTokens;
  into.reasoningTokens += day.reasoningTokens;
  into.totalTokens += day.totalTokens;
  into.apiEquivalentCostUSD += day.apiEquivalentCostUSD;
  if (day.totalTokens > 0 && !day.costComplete) into.costComplete = false;
  for (const { model, tokens } of day.models) {
    if (isVisibleCodingModel(model)) into.models.set(model, (into.models.get(model) ?? 0) + tokens);
  }
}

/** 费用是浮点累加；截到微美元，同一份账本算两次得出同一个 JSON */
function dollars(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/** 模型按 token 降序、同量按名字排 */
function ranked(models: Map<string, number>): Array<[string, number]> {
  return [...models].sort(([leftModel, left], [rightModel, right]) => right - left || leftModel.localeCompare(rightModel));
}

function dayTotals(date: string, totals: DayTotals): CodingUsageDayTotals {
  return {
    date,
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    cacheReadTokens: totals.cacheReadTokens,
    cacheCreationTokens: totals.cacheCreationTokens,
    totalTokens: totals.totalTokens,
    apiEquivalentCostUSD: dollars(totals.apiEquivalentCostUSD),
    costComplete: totals.costComplete,
  };
}

/**
 * 由各来源的账本算出公开视图与年度视图。
 *
 * 1. 每个 agent 按登记的来源规则（shared/coding-usage-sources）选出参与合计的来源，
 *    落选的在 `status` 里标 `superseded` / `conflict`，它们的日子哪里都不算；
 * 2. 参与来源的日行逐日相加：合计、费用、每天的模型拆分都在完整数据上精确累加，
 *    前三模型和每天前五不在截断过的名单上相加；
 * 3. `activeDays` 是全部历史里「各 agent 当天合计 > 0」的站点日个数；
 * 4. `costComplete` 看所有有 token 的日行 —— 来源采集失败只体现在 `status`，不拉低已知费用的完整性；
 * 5. `lastDay` 是该 agent 最近一个有行的站点日（全 0 的行也算：那是确认过的没用），各参与来源当天相加；
 * 6. 年度视图留 `updatedAt` 所在站点日往前 `CODING_YEAR_KEEP_DAYS` 天，只留有用量的日子。
 */
export function buildCodingUsageView(stored: StoredCodingUsage, updatedAt: number): CodingUsageViews {
  const ids = [...new Set(CODING_USAGE_SOURCE_NAMES.flatMap((source) => Object.keys(stored[source] ?? {})))].sort();
  const yearStart = zonedDay(updatedAt - (CODING_YEAR_KEEP_DAYS - 1) * DAY_MS, site.timezone);

  const totals = emptyTotals();
  const byDate = new Map<string, DayTotals>();
  const sessionCounts: number[] = [];
  const agents: CodingUsageAgentView[] = [];

  for (const id of ids) {
    const present = CODING_USAGE_SOURCE_NAMES.filter((source) => stored[source]?.[id]);
    const roles = resolveCodingUsageSources(present);
    const ledgerOf = (source: CodingUsageSource) => stored[source]![id]!;

    const status: CodingUsageSourceStatus[] = present.map((source) => {
      const ledger = ledgerOf(source);
      const state = roles.superseded.includes(source) ? "superseded" : roles.conflict.includes(source) ? "conflict" : ledger.state;
      return { source, state, collectedAt: ledger.collectedAt, error: ledger.error, warning: ledger.warning };
    });

    const days = new Map<string, DayTotals>();
    const agentSessions: number[] = [];
    for (const source of roles.contributing) {
      const ledger = ledgerOf(source);
      if (ledger.sessionCount != null) agentSessions.push(ledger.sessionCount);
      for (const day of ledger.days) {
        const agentDay = days.get(day.date) ?? emptyTotals();
        addDay(agentDay, day);
        days.set(day.date, agentDay);
        addDay(totals, day);
        const siteDay = byDate.get(day.date) ?? emptyTotals();
        addDay(siteDay, day);
        byDate.set(day.date, siteDay);
      }
    }
    if (agentSessions.length) sessionCounts.push(agentSessions.reduce((sum, value) => sum + value, 0));

    const allModels = new Map<string, number>();
    for (const day of days.values()) {
      for (const [model, tokens] of day.models) allModels.set(model, (allModels.get(model) ?? 0) + tokens);
    }
    const dates = [...days.keys()].sort();
    const latestDate = dates.at(-1);
    const latestModel = dates.reverse().map((date) => ranked(days.get(date)!.models)[0]?.[0]).find((model) => model != null) ?? null;

    agents.push({
      id,
      sources: roles.contributing,
      models: ranked(allModels).slice(0, CODING_AGENT_MODELS).map(([model]) => model),
      latestModel,
      lastDay: latestDate ? dayTotals(latestDate, days.get(latestDate)!) : null,
      status,
    });
  }

  const view: CodingUsagePayload = {
    updatedAt,
    totals: ids.length ? codingTotals(totals, byDate, sessionCounts) : null,
    topModels: ranked(totals.models).slice(0, CODING_TOP_MODELS).map(([model, tokens]) => ({ model, tokens })),
    agents,
  };
  const year: CodingUsageYearView = {
    updatedAt,
    days: Object.fromEntries([...byDate]
      .filter(([date, day]) => date >= yearStart && day.totalTokens > 0)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([date, day]) => [date, { tokens: day.totalTokens, models: ranked(day.models).slice(0, CODING_YEAR_TOP_MODELS) }])),
  };
  return { view, year };
}

/**
 * 只有状态变了（采集时刻、`state`、`error`、`warning`；日子与会话数没动）：在存着的视图上换掉这个来源
 * 这几格的状态，不重扫日行。参与合计的来源只由「有哪些来源」定，状态改不了它，所以 `superseded` /
 * `conflict` 照旧。视图里找不到对应的那一格（视图和账本对不上）返回 null，调用方整份重算。
 */
export function applyCodingUsageStatus(
  view: CodingUsagePayload,
  source: CodingUsageSource,
  ledgers: Readonly<Record<string, Omit<StoredCodingUsageAgent, "days">>>,
): CodingUsagePayload | null {
  const pending = new Set(Object.keys(ledgers));
  const agents = view.agents.map((agent) => {
    const ledger = ledgers[agent.id];
    if (!ledger || !agent.status.some((row) => row.source === source)) return agent;
    pending.delete(agent.id);
    return {
      ...agent,
      status: agent.status.map((row): CodingUsageSourceStatus => row.source !== source ? row : {
        source,
        state: row.state === "superseded" || row.state === "conflict" ? row.state : ledger.state,
        collectedAt: ledger.collectedAt,
        error: ledger.error,
        warning: ledger.warning,
      }),
    };
  });
  return pending.size ? null : { ...view, agents };
}

function codingTotals(totals: DayTotals, byDate: Map<string, DayTotals>, sessionCounts: number[]): CodingUsageTotals {
  return {
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    cacheReadTokens: totals.cacheReadTokens,
    cacheCreationTokens: totals.cacheCreationTokens,
    reasoningTokens: totals.reasoningTokens,
    totalTokens: totals.totalTokens,
    apiEquivalentCostUSD: dollars(totals.apiEquivalentCostUSD),
    costComplete: totals.costComplete,
    activeDays: [...byDate.values()].filter((day) => day.totalTokens > 0).length,
    sessionCount: sessionCounts.length ? sessionCounts.reduce((sum, value) => sum + value, 0) : null,
  };
}

/** 一个来源最近一封活动报告里的各 agent（`coding:activity:<来源>`） */
type ActivitySource = { agents: ReadonlyArray<{ id: string; lastActivityAt: number | null; model: string | null }> };

/**
 * `/api/status/coding/now` 与 `coding-now` 推送的 agents 部分：推送和读出口必须用这一个函数拼，
 * 两边给浏览器的才是同一个值。
 *
 * 各来源的最近事件按 agent 并起来、时刻降序；从没见过用量事件（时刻为 null）的不列。
 * 占位模型名（`<synthetic>` 之类）换成 null。灯亮不亮、Mac 亲口离线时 `mac` 那条作不作废，
 * 都由浏览器按自己的钟和存活现算。
 */
export function buildCodingNowAgents(activities: Partial<Record<CodingUsageSource, ActivitySource | null>>): CodingNowPayload["agents"] {
  const byId = new Map<string, CodingNowPayload["agents"][number]["activity"]>();
  for (const source of CODING_USAGE_SOURCE_NAMES) {
    for (const agent of activities[source]?.agents ?? []) {
      if (agent.lastActivityAt == null) continue;
      const entries = byId.get(agent.id) ?? [];
      entries.push({ source, lastActivityAt: agent.lastActivityAt, model: isVisibleCodingModel(agent.model) ? agent.model : null });
      byId.set(agent.id, entries);
    }
  }
  return [...byId]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([id, activity]) => ({ id, activity: activity.sort((left, right) => right.lastActivityAt - left.lastActivityAt) }));
}
