/**
 * Claude Code 云端线程的用量。OTLP 指标在上报入口解析、丢掉账号字段（shared/ingest/claude-cloud），
 * 这里在状态核心里做差、按日累计。
 *
 * 云端要求 cumulative 时序：同一进程内起点不变、值只增不减，每轮全量重发。每条序列
 * （指标、进程起点、全部属性，含 query_source：主会话和子代理是两条）记上次的值，这次只加差值 ——
 * 丢一轮下一轮自己补齐，重发和乱序都不会多算。delta 时序的点直接相加，只是兜底。
 *
 * 云端会话和 Mac 本机的会话记录不重叠，读出口把这里的日桶整份加进 Mac 那份，
 * 不用像 Cursor 那样锚定日做差。
 */

import type { OtlpTokenType, OtlpUsagePoint } from "@shared/ingest/claude-cloud";

import { zonedDay } from "./heatmap-window.ts";
import { site } from "./site.ts";
import type { VibeCodingDay } from "./types.ts";
import { addUsageDays, clampTokens, type UsageDayDelta, type YearShape } from "./usage-day-merge.ts";
import type { ParsedVibeCodingUsage } from "./vibecoding-parse.ts";

const TOKEN_FIELD: Record<OtlpTokenType, "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheCreationTokens"> = {
  input: "inputTokens",
  output: "outputTokens",
  cacheRead: "cacheReadTokens",
  cacheCreation: "cacheCreationTokens",
};

const DAY_MS = 86_400_000;
/** 日桶留一年多一点，够年度图 53 周 */
const KEEP_DAYS = 400;
/**
 * 进程计数器记多久。云端线程闲置后会暂停，恢复时若还是同一个进程，起点不变、值接着涨；
 * 记录删早了会把整段累计值再算一遍。一个月没见的进程当它结束了。
 */
const SERIES_TTL_MS = 30 * DAY_MS;
const MAX_SERIES = 5_000;

export type ClaudeCloudDay = UsageDayDelta;

export type ClaudeCloudUsage = {
  days: ClaudeCloudDay[];
  /** 键是序列摘要（指标、进程起点、全部属性）；值是上次收到的累计值 */
  series: Record<string, { value: number; seenAt: number }>;
  /** 见过的会话（session.id 摘要）与最后一次见到的时刻，只用来数会话数 */
  sessions: Record<string, number>;
  sessionCount: number;
  /** 最近一个带用量的数据点的时刻（epoch 毫秒）。卡片拿它点 Claude 那盏灯 */
  lastPointAt: number | null;
  /** 最近一次有 token 增量的模型，云端比本机新时当此刻模型 */
  lastModel: string | null;
};

function emptyDay(date: string): ClaudeCloudDay {
  return {
    date,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 0,
    apiEquivalentCostUSD: 0,
    models: [],
  };
}

function cloneDay(day: ClaudeCloudDay): ClaudeCloudDay {
  return { ...day, models: day.models.map((row) => ({ ...row })) };
}

function newest<T>(entries: Array<[string, T]>, seenAt: (value: T) => number, cutoff: number, limit: number) {
  return Object.fromEntries(
    entries
      .filter(([, value]) => seenAt(value) >= cutoff)
      .sort((left, right) => seenAt(right[1]) - seenAt(left[1]))
      .slice(0, limit),
  );
}

/** StateHub 里做：差值依赖权威的上一次累计值。`changed` 为 false 时这一封没带来新用量。 */
export function applyOtlpUsage(
  previous: ClaudeCloudUsage | null,
  points: OtlpUsagePoint[],
  receivedAt: number,
): { usage: ClaudeCloudUsage; changed: boolean } {
  const series = { ...(previous?.series ?? {}) };
  const sessions = { ...(previous?.sessions ?? {}) };
  let sessionCount = previous?.sessionCount ?? 0;
  let lastPointAt = previous?.lastPointAt ?? null;
  let lastModel = previous?.lastModel ?? null;
  let lastModelAt = lastPointAt ?? 0;
  const days = new Map((previous?.days ?? []).map((day) => [day.date, cloneDay(day)]));
  let changed = false;

  for (const point of points) {
    if (!(point.session in sessions)) sessionCount += 1;
    sessions[point.session] = receivedAt;

    let delta = point.value;
    if (point.cumulative) {
      const before = series[point.series];
      // 乱序到达的旧点比记下的小：不回退，也不加
      delta = before ? Math.max(0, point.value - before.value) : point.value;
      series[point.series] = { value: Math.max(point.value, before?.value ?? 0), seenAt: receivedAt };
    }
    if (delta <= 0) continue;

    const date = zonedDay(point.timeMs, site.timezone);
    const day = days.get(date) ?? emptyDay(date);
    if (point.metric === "cost") {
      day.apiEquivalentCostUSD += delta;
    } else if (point.type) {
      const tokens = Math.round(delta);
      if (tokens <= 0) continue;
      day[TOKEN_FIELD[point.type]] += tokens;
      day.totalTokens += tokens;
      if (point.model) {
        const row = day.models.find((entry) => entry.model === point.model);
        if (row) row.tokens += tokens;
        else day.models.push({ model: point.model, tokens });
        if (point.timeMs >= lastModelAt) {
          lastModel = point.model;
          lastModelAt = point.timeMs;
        }
      }
    }
    days.set(date, day);
    lastPointAt = Math.max(lastPointAt ?? 0, point.timeMs);
    changed = true;
  }

  const cutoffDay = zonedDay(receivedAt - KEEP_DAYS * DAY_MS, site.timezone);
  const cutoff = receivedAt - SERIES_TTL_MS;
  return {
    usage: {
      days: [...days.values()]
        .filter((day) => day.date >= cutoffDay)
        .map((day) => ({ ...day, models: day.models.sort((left, right) => right.tokens - left.tokens) }))
        .sort((left, right) => (left.date < right.date ? -1 : 1)),
      series: newest(Object.entries(series), (value) => value.seenAt, cutoff, MAX_SERIES),
      sessions: newest(Object.entries(sessions), (value) => value, cutoff, MAX_SERIES),
      sessionCount,
      lastPointAt,
      lastModel,
    },
    changed,
  };
}

function toPublicDay(day: ClaudeCloudDay): VibeCodingDay {
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

function addDay(left: VibeCodingDay, right: VibeCodingDay): VibeCodingDay {
  return {
    date: left.date,
    inputTokens: clampTokens(left.inputTokens + right.inputTokens),
    outputTokens: clampTokens(left.outputTokens + right.outputTokens),
    cacheReadTokens: clampTokens(left.cacheReadTokens + right.cacheReadTokens),
    cacheCreationTokens: clampTokens(left.cacheCreationTokens + right.cacheCreationTokens),
    totalTokens: clampTokens(left.totalTokens + right.totalTokens),
    apiEquivalentCostUSD: left.apiEquivalentCostUSD + right.apiEquivalentCostUSD,
  };
}

function overlayClaude(
  agents: ParsedVibeCodingUsage["agents"],
  cloud: ClaudeCloudUsage,
  now: number,
): ParsedVibeCodingUsage["agents"] {
  const date = zonedDay(now, site.timezone);
  const cloudToday = cloud.days.find((day) => day.date === date) ?? null;
  const cloudModels = new Map<string, number>();
  for (const day of cloud.days) {
    for (const row of day.models) cloudModels.set(row.model, (cloudModels.get(row.model) ?? 0) + row.tokens);
  }
  const ranked = [...cloudModels].sort((left, right) => right[1] - left[1]).map(([model]) => model);
  const next = agents.map((agent) => ({ ...agent, models: [...agent.models] }));
  const claude = next.find((agent) => agent.id === "claude");
  if (!claude) {
    next.unshift({
      id: "claude",
      label: "Claude Code",
      icon: "anthropic",
      models: ranked,
      currentModel: null,
      topModel: ranked[0] ?? null,
      today: cloudToday ? toPublicDay(cloudToday) : null,
      usageStatus: {
        state: "ok",
        collectedAt: cloud.lastPointAt == null ? null : new Date(cloud.lastPointAt).toISOString(),
        error: null,
        warning: null,
        coverageStart: cloud.days[0]?.date ?? null,
        coverageEnd: cloud.days.at(-1)?.date ?? null,
        precision: "measured",
        costComplete: true,
      },
    });
    return next;
  }
  for (const model of ranked) if (!claude.models.includes(model)) claude.models.push(model);
  if (cloudToday) {
    const cloudDay = toPublicDay(cloudToday);
    // Mac 那行停在昨天（合盖了）时不能把今天的云端用量加到昨天上
    claude.today = claude.today?.date === date ? addDay(claude.today, cloudDay) : cloudDay;
  }
  return next;
}

/** 读出口现算，接在 Cursor 合并之后。不改镜像里的 Mac 原件。 */
export function mergeClaudeCloudUsage<Year extends YearShape>(
  usage: ParsedVibeCodingUsage,
  cloud: ClaudeCloudUsage | null,
  year: Year | null,
  now: number,
): { usage: ParsedVibeCodingUsage; year: Year | null } {
  if (!cloud || cloud.days.length === 0) return { usage, year };
  const rows = cloud.days.map((day) => ({ delta: day, adjustModels: true, costComplete: true }));
  const merged = addUsageDays(usage, rows, year);
  const cloudCollected = cloud.lastPointAt == null ? null : new Date(cloud.lastPointAt).toISOString();
  return {
    usage: {
      ...usage,
      agents: overlayClaude(usage.agents, cloud, now),
      totals: { ...merged.totals, sessionCount: usage.totals.sessionCount + cloud.sessionCount },
      topModels: merged.topModels,
      collectedAt:
        cloudCollected && Date.parse(cloudCollected) > Date.parse(usage.collectedAt) ? cloudCollected : usage.collectedAt,
    },
    year: merged.year,
  };
}

/**
 * Claude 那一行的此刻：云端最近活动时刻，以及云端比本机新时换成云端的模型。
 * 快照出口和云端遥测那条推送共用，两边给浏览器的是同一个值。
 */
export function claudeCloudNow(
  cloud: Pick<ClaudeCloudUsage, "lastPointAt" | "lastModel"> | null,
  local: { currentModel: string | null; lastActivityAt: string | null } | null,
): { cloudActivityAt: string | null; currentModel: string | null } {
  const at = cloud?.lastPointAt ?? null;
  const localAt = local?.lastActivityAt ? Date.parse(local.lastActivityAt) : null;
  const cloudNewer = at != null && cloud?.lastModel != null && (localAt == null || at > localAt);
  return {
    cloudActivityAt: at == null ? null : new Date(at).toISOString(),
    currentModel: cloudNewer ? cloud.lastModel : local?.currentModel ?? null,
  };
}
