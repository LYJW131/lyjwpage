import { zonedDay } from "@/lib/heatmap-window";
import type { LiveEvent } from "@/lib/live-events";
import { site } from "@/lib/site";
import { askStorage, tellStorage } from "@/lib/storage";
import { fanout } from "@api/fanout";
import type { CodingBucketDelta } from "@shared/coding-buckets";
import { codingOtlpKey, codingUsageKey, parseOtlpCounters, parseStoredUsageLedgers, type StoredOtlpCounters } from "@shared/coding-store";
import type { CodingUsageAgent, CodingUsageDay } from "@shared/coding-usage";
import type { OtlpTokenType, PreparedClaudeCloudUsage } from "@shared/ingest/claude-cloud";
import type { StorageBatch } from "@shared/storage-client";

import { prepareCodingActivity, readCodingActivities } from "./coding-activity";
import { prepareOtlpBuckets } from "./coding-buckets";
import { prepareCodingUsage } from "./coding-usage";
import { migrateLegacyCodingUsage } from "./coding-usage-migrate";

/**
 * Claude Code 云端线程的 OTLP 指标，状态核心那一半。解析在上报入口（shared/ingest/claude-cloud.ts）。
 *
 * 只收 cumulative 时序：同一进程内起点不变、值只增不减，每轮全量重发。每条序列
 * （指标、进程起点、全部属性，含 query_source：主会话和子代理是两条）记上次的值，这次只加差值 ——
 * 丢一轮下一轮自己补齐，重发和乱序都不会多算。做差要拿权威的上一次累计值，所以只能在这里做。
 * delta 时序的点不收、记一行 warn：它没法去重，提交成功而回执丢了时导出端重发就会重复计数；
 * 云端环境按 workers/ingress/README.md 配了 cumulative（Claude Code 的默认是 delta），见到 warn
 * 就是那组变量掉了。
 *
 * 每个正差值同时落成和另外两个来源同形的三种事实（来源 `agents-otlp`，agent `claude`）：
 * - 日行：按数据点时刻的站点日，`type` 加进四列、`model` 加进模型拆分；`cost` 点加进费用，
 *   `costComplete` 恒为 true（Claude Code 自报）；
 * - 5 分钟桶：差值归到数据点时刻所在的桶（差值实际覆盖上一次导出到这次之间约一分钟，
 *   桶边界上最多错一分钟）；事件数数不出来；
 * - 活动：有 token 正差值的最新数据点时刻与模型。
 *
 * 云端会话和 Mac 本机的会话记录不重叠：来源规则里两者都是非账号级，相加（shared/coding-usage-sources）。
 *
 * 计数器和它做出来的差值必须一起落：先读完全部（计数器、三个来源的账本与视图、活动、桶），
 * 再把计数器、账本连同视图与年度、活动、桶排进同一批，一个 SQLite 事务写下。中途哪一步失败就
 * 一条都不落，计数器停在前值，累计序列的下一封（或重发）照旧从这个前值做差，差值不丢；计数器
 * 先落、账本后落的话，中间失败一次，这段差值就永远补不回来了。
 *
 * 入口的收到时刻和这里的提交顺序可以相反（两封几乎同时到、各走各的入口实例）。差值按提交顺序做，
 * 账本不走快照淘汰（prepareCodingUsage 的 `derived`），账本、活动、桶上的时刻都取和存着的较大者、
 * 不往回走 —— 否则后提交的那封会被当成旧快照丢掉账本，计数器和桶却照样前进。
 */

const TOKEN_FIELD: Record<OtlpTokenType, "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheCreationTokens"> = {
  input: "inputTokens",
  output: "outputTokens",
  cacheRead: "cacheReadTokens",
  cacheCreation: "cacheCreationTokens",
};

const DAY_MS = 86_400_000;
/**
 * 进程计数器记多久。云端线程闲置后会暂停，恢复时若还是同一个进程，起点不变、值接着涨；
 * 记录删早了会把整段累计值再算一遍。一个月没见的进程当它结束了。
 */
const SERIES_TTL_MS = 30 * DAY_MS;
const MAX_SERIES = 5_000;

function newest<T>(entries: Array<[string, T]>, seenAt: (value: T) => number, cutoff: number, limit: number) {
  return Object.fromEntries(
    entries
      .filter(([, value]) => seenAt(value) >= cutoff)
      .sort((left, right) => seenAt(right[1]) - seenAt(left[1]))
      .slice(0, limit),
  );
}

function emptyDay(date: string): CodingUsageDay {
  return {
    date, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, reasoningTokens: 0,
    totalTokens: 0, apiEquivalentCostUSD: 0, costComplete: true, models: [],
  };
}

function bucketDelta(at: number, model: string | null, type: OtlpTokenType, tokens: number): CodingBucketDelta {
  const delta: CodingBucketDelta = { at, id: "claude", model, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
  delta[TOKEN_FIELD[type]] = tokens;
  return delta;
}

export async function recordPreparedClaudeCloudUsage(prepared: PreparedClaudeCloudUsage) {
  const { points, receivedAt } = prepared;
  if (points.length === 0) return { accepted: 0 };
  // 旧键里的累计计数器要在第一次做差之前转过来，否则活着的进程会被整份重算一遍
  const migrated = await migrateLegacyCodingUsage(receivedAt);
  const answered = await askStorage((storage) => storage.batch().get(codingOtlpKey()).fields(codingUsageKey("agents-otlp")).execute());
  if (!answered.reachable) throw new Error("云端用量计数器读不到");
  const counters = parseOtlpCounters(answered.value[0]);
  const ledger = parseStoredUsageLedgers(answered.value[1]).claude;

  const series = { ...(counters?.series ?? {}) };
  const sessions = { ...(counters?.sessions ?? {}) };
  let sessionCount = counters?.sessionCount ?? 0;
  const days = new Map((ledger?.days ?? []).map((day) => [day.date, { ...day, models: day.models.map((row) => ({ ...row })) }]));
  const deltas: CodingBucketDelta[] = [];
  /** 这一封里有 token 正差值的最新数据点；没有模型名的点沿用前一个模型 */
  let latestAt: number | null = null;
  let latestModel: string | null = null;
  let changed = false;
  let deltaPoints = 0;

  for (const point of points) {
    if (!point.cumulative) {
      deltaPoints += 1;
      continue;
    }
    if (!(point.session in sessions)) sessionCount += 1;
    sessions[point.session] = Math.max(receivedAt, sessions[point.session] ?? 0);

    const before = series[point.series];
    // 乱序到达的旧点比记下的小：不回退，也不加
    const delta = before ? Math.max(0, point.value - before.value) : point.value;
    series[point.series] = { value: Math.max(point.value, before?.value ?? 0), seenAt: Math.max(receivedAt, before?.seenAt ?? 0) };
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
      }
      deltas.push(bucketDelta(point.timeMs, point.model, point.type, tokens));
      if (latestAt == null || point.timeMs >= latestAt) {
        latestAt = point.timeMs;
        latestModel = point.model ?? latestModel;
      }
    } else {
      continue;
    }
    days.set(date, day);
    changed = true;
  }

  if (deltaPoints) console.warn("[otlp] delta temporality points skipped; set OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=cumulative", deltaPoints);

  const cutoff = receivedAt - SERIES_TTL_MS;
  const nextCounters: StoredOtlpCounters = {
    series: newest(Object.entries(series), (value) => value.seenAt, cutoff, MAX_SERIES),
    sessions: newest(Object.entries(sessions), (value) => value, cutoff, MAX_SERIES),
    sessionCount,
  };
  const staged: Array<(batch: StorageBatch) => void> = [];
  const events: LiveEvent[] = [];
  const tags: string[] = [];

  // 日行或会话数变了才整理成账本；闲着的进程每分钟一封也不会让视图每分钟重算
  if (changed || migrated || sessionCount !== (ledger?.sessionCount ?? 0)) {
    const agent: CodingUsageAgent = {
      id: "claude",
      state: "ok",
      collectedAt: changed || !ledger ? Math.max(receivedAt, ledger?.collectedAt ?? 0) : ledger.collectedAt,
      error: null,
      warning: null,
      sessionCount,
      days: [...days.values()]
        .map((day) => ({ ...day, models: day.models.sort((left, right) => right.tokens - left.tokens || left.model.localeCompare(right.model)) }))
        .sort((left, right) => left.date.localeCompare(right.date)),
    };
    const usage = await prepareCodingUsage("agents-otlp", { agents: [agent] }, receivedAt, { recompute: migrated, derived: true });
    staged.push(usage.stage);
    tags.push(...usage.tags);
  }

  if (latestAt != null) {
    const stored = (await readCodingActivities())["agents-otlp"];
    const previous = stored?.agents.find((agent) => agent.id === "claude");
    const newer = previous?.lastActivityAt != null && previous.lastActivityAt > latestAt
      ? { at: previous.lastActivityAt, model: previous.model }
      : { at: latestAt, model: latestModel };
    const activity = await prepareCodingActivity("agents-otlp", {
      collectedAt: Math.max(receivedAt, stored?.collectedAt ?? 0),
      agents: [{ id: "claude", lastActivityAt: newer.at, model: newer.model }],
    }, receivedAt);
    staged.push(activity.stage);
    if (activity.event) events.push(activity.event);
  }

  const buckets = await prepareOtlpBuckets(deltas, receivedAt);
  staged.push(buckets.stage);

  const write = tellStorage((storage) => {
    const batch = storage.batch().set(codingOtlpKey(), JSON.stringify(nextCounters));
    for (const stage of staged) stage(batch);
    return batch.execute();
  });
  await fanout({ writes: [write], events, tags });
  return { accepted: points.length - deltaPoints };
}
