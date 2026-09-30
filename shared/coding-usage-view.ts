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


export type StoredCodingUsageAgent = Omit<CodingUsageAgent, "days"> & {
  days: CodingUsageDay[];
  receivedAt: number;
  revision?: number;
};

export type StoredCodingUsage = Partial<Record<CodingUsageSource, Record<string, StoredCodingUsageAgent>>>;

export type CodingUsageYearView = {
  updatedAt: number;
  days: Record<string, { tokens: number; models: Array<[model: string, tokens: number]> }>;
};

export type CodingUsageViews = { view: CodingUsagePayload; year: CodingUsageYearView };

export const CODING_TOP_MODELS = 3;
export const CODING_AGENT_MODELS = 20;
export const CODING_YEAR_KEEP_DAYS = 380;
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

// 浮点累加需量化，保证相同账本生成稳定的 JSON。
function dollars(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

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

type ActivitySource = { agents: ReadonlyArray<{ id: string; lastActivityAt: number | null; model: string | null }> };

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
