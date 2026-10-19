import { zonedDay } from "@shared/heatmap-window";
import type { LiveEvent } from "@shared/live-events";
import { site } from "@shared/site";
import { getStorage } from "@shared/storage";
import { fanout } from "@core/fanout";
import type { CodingBucketDelta } from "@shared/coding-buckets";
import { codingOtlpKey, codingUsageKey, parseOtlpCounters, parseStoredUsageLedgers, type StoredOtlpCounters } from "@shared/coding-store";
import type { CodingUsageAgent, CodingUsageDay } from "@shared/coding-usage";
import { isOtlpCodingSource, type CodingUsageSource, type OtlpCodingSource } from "@shared/coding-usage-sources";
import type { OtlpAgentId, OtlpTokenType, PreparedAgentsOtlpUsage } from "@shared/ingest/agents-otlp";
import type { StorageBatch } from "@shared/storage-client";

import { prepareCodingActivity, readCodingActivities } from "./coding-activity";
import { prepareBucketsWithout, prepareOtlpBuckets } from "./coding-buckets";
import { prepareCodingUsage } from "./coding-usage";

// 计数器与差值账本必须同事务落库；计数器先成功会让失败的差值永远补不回来。

const TOKEN_FIELD: Record<OtlpTokenType, "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheCreationTokens"> = {
  input: "inputTokens",
  output: "outputTokens",
  cacheRead: "cacheReadTokens",
  cacheCreation: "cacheCreationTokens",
};

const DAY_MS = 86_400_000;
// 云端进程暂停后可能沿用累计计数器，过早删除基线会把全部历史重复计入。
const SERIES_TTL_MS = 30 * DAY_MS;
const MAX_SERIES = 5_000;
// agent 换了来源时，第一次在新来源收到它就把旧来源里它的日行账本接过来，旧来源那行删掉。
// agents-otlp：Devin CLI 的用量以前由 agents-reporter 从 tokens.ci 拉进账号级来源。之后账号级那边再冒出这一行（旧镜像还在跑）
// 也照样删掉（always），否则它会压住 OTLP；账号级桶里它的行同理，只删不接。
// mac-otlp：Mac 上 Devin CLI 的 OTLP 以前记在 agents-otlp。只接一次，连同会话数、活动和桶（carry）；
// 之后 agents-otlp 里的 devin 是云端环境里跑的，不再动。
const MOVES: Record<OtlpCodingSource, { from: CodingUsageSource; ids: readonly OtlpAgentId[]; always: boolean; carry: boolean }> = {
  "agents-otlp": { from: "agents", ids: ["devin"], always: true, carry: false },
  "mac-otlp": { from: "agents-otlp", ids: ["devin"], always: false, carry: true },
};

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

function bucketDelta(at: number, id: OtlpAgentId, model: string | null, type: OtlpTokenType, tokens: number): CodingBucketDelta {
  const delta: CodingBucketDelta = { at, id, model, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 };
  delta[TOKEN_FIELD[type]] = tokens;
  return delta;
}

function copyDays(days: readonly CodingUsageDay[] | undefined): Map<string, CodingUsageDay> {
  return new Map((days ?? []).map((day) => [day.date, { ...day, models: day.models.map((row) => ({ ...row })) }]));
}

type AgentBook = {
  days: Map<string, CodingUsageDay>;
  previous: CodingUsageAgent | undefined;
  changed: boolean;
  latestAt: number | null;
  latestModel: string | null;
};

export async function recordPreparedAgentsOtlpUsage(prepared: PreparedAgentsOtlpUsage) {
  const { points, receivedAt, source } = prepared;
  if (points.length === 0) return { accepted: 0 };
  const move = MOVES[source];
  const fromOtlp = isOtlpCodingSource(move.from) ? move.from : null;
  const stored = await getStorage().batch()
    .get(codingOtlpKey(source))
    .fields(codingUsageKey(source))
    .fields(codingUsageKey(move.from))
    .get(codingOtlpKey(fromOtlp ?? source))
    .execute();
  const counters = parseOtlpCounters(stored[0]);
  const ledgers = parseStoredUsageLedgers(stored[1]);
  const fromLedgers = parseStoredUsageLedgers(stored[2]);
  const fromCounters = fromOtlp ? parseOtlpCounters(stored[3]) : null;

  const series = { ...(counters?.series ?? {}) };
  const windows = { ...(counters?.windows ?? {}) };
  const sessions = { ...(counters?.sessions ?? {}) };
  const sessionCounts = { ...(counters?.sessionCounts ?? {}) };
  const books = new Map<OtlpAgentId, AgentBook>();
  const moved: OtlpAgentId[] = [];
  const book = (id: OtlpAgentId): AgentBook => {
    let entry = books.get(id);
    if (!entry) {
      const own = ledgers[id];
      const old = move.ids.includes(id) && (move.always || !own) ? fromLedgers[id] : undefined;
      if (old) moved.push(id);
      const inherited = own ? undefined : old;
      if (inherited && move.carry) {
        sessionCounts[id] = Math.max(sessionCounts[id] ?? 0, inherited.sessionCount ?? 0);
        // 旧来源已计到的 delta 水位一起接过来：切换那一刻 exporter 重发的旧窗口不能在新来源再记一次。
        for (const [key, value] of Object.entries(fromCounters?.windows ?? {})) windows[key] ??= value;
      }
      entry = { days: copyDays((own ?? inherited)?.days), previous: own, changed: Boolean(inherited), latestAt: null, latestModel: null };
      books.set(id, entry);
    }
    return entry;
  };
  const deltas: CodingBucketDelta[] = [];
  let skippedDelta = 0;

  for (const point of points) {
    if (!point.cumulative && !point.acceptsDelta) {
      skippedDelta += 1;
      continue;
    }
    const entry = book(point.agent);
    if (!(point.session in sessions)) sessionCounts[point.agent] = (sessionCounts[point.agent] ?? 0) + 1;
    sessions[point.session] = Math.max(receivedAt, sessions[point.session] ?? 0);

    let delta: number;
    if (point.cumulative) {
      const before = series[point.series];
      delta = before ? Math.max(0, point.value - before.value) : point.value;
      series[point.series] = { value: Math.max(point.value, before?.value ?? 0), seenAt: Math.max(receivedAt, before?.seenAt ?? 0) };
    } else {
      // delta 窗口首尾相接（中间没用量的窗口不发）；起点早于已计到的时刻就是重发，整点跳过。
      const before = windows[point.series];
      if (before && point.startMs < before.until) continue;
      delta = point.value;
      windows[point.series] = { until: point.timeMs, seenAt: Math.max(receivedAt, before?.seenAt ?? 0) };
    }
    if (delta <= 0) continue;

    const date = zonedDay(point.timeMs, site.timezone);
    const day = entry.days.get(date) ?? emptyDay(date);
    if (point.metric === "cost") {
      day.apiEquivalentCostUSD += delta;
    } else if (point.type) {
      const tokens = Math.round(delta);
      if (tokens <= 0) continue;
      day[TOKEN_FIELD[point.type]] += tokens;
      day.totalTokens += tokens;
      // Devin 不发费用指标，它自家模型也没有公开价。
      if (point.agent === "devin") day.costComplete = false;
      if (point.model) {
        const row = day.models.find((model) => model.model === point.model);
        if (row) row.tokens += tokens;
        else day.models.push({ model: point.model, tokens });
      }
      deltas.push(bucketDelta(point.timeMs, point.agent, point.model, point.type, tokens));
      if (entry.latestAt == null || point.timeMs >= entry.latestAt) {
        entry.latestAt = point.timeMs;
        entry.latestModel = point.model ?? entry.latestModel;
      }
    } else {
      continue;
    }
    entry.days.set(date, day);
    entry.changed = true;
  }

  if (skippedDelta) console.warn("[otlp] delta temporality points skipped; set OTEL_EXPORTER_OTLP_METRICS_TEMPORALITY_PREFERENCE=cumulative", skippedDelta);

  const cutoff = receivedAt - SERIES_TTL_MS;
  const nextCounters: StoredOtlpCounters = {
    series: newest(Object.entries(series), (value) => value.seenAt, cutoff, MAX_SERIES),
    windows: newest(Object.entries(windows), (value) => value.seenAt, cutoff, MAX_SERIES),
    sessions: newest(Object.entries(sessions), (value) => value, cutoff, MAX_SERIES),
    sessionCounts,
  };
  const staged: Array<(batch: StorageBatch) => void> = [];
  const events: LiveEvent[] = [];
  const tags: string[] = [];

  const agents: CodingUsageAgent[] = [];
  for (const [id, entry] of books) {
    const { previous, changed } = entry;
    const sessionCount = sessionCounts[id] ?? 0;
    if (!changed && sessionCount === (previous?.sessionCount ?? 0)) continue;
    agents.push({
      id,
      state: "ok",
      collectedAt: changed || !previous ? Math.max(receivedAt, previous?.collectedAt ?? 0) : previous.collectedAt,
      error: null,
      warning: null,
      sessionCount,
      days: [...entry.days.values()]
        .map((day) => ({ ...day, models: day.models.sort((left, right) => right.tokens - left.tokens || left.model.localeCompare(right.model)) }))
        .sort((left, right) => left.date.localeCompare(right.date)),
    });
  }
  if (agents.length || moved.length) {
    const usage = await prepareCodingUsage(source, { agents }, receivedAt, {
      derived: true,
      ...(moved.length ? { moveFrom: { source: move.from, ids: moved } } : {}),
    });
    staged.push(usage.stage);
    tags.push(...usage.tags);
  }

  const activities = await readCodingActivities();
  const movedActivity = move.carry ? (activities[move.from]?.agents ?? []).filter((agent) => moved.includes(agent.id as OtlpAgentId)) : [];
  if (movedActivity.length) {
    const left = activities[move.from]!;
    const activity = await prepareCodingActivity(move.from, {
      collectedAt: Math.max(receivedAt, left.collectedAt),
      agents: left.agents.filter((agent) => !moved.includes(agent.id as OtlpAgentId)),
    }, receivedAt);
    staged.push(activity.stage);
    if (activity.event) events.push(activity.event);
  }
  const active = [...books].filter(([, entry]) => entry.latestAt != null);
  if (active.length || movedActivity.length) {
    const stored = activities[source];
    const rows = new Map([...movedActivity, ...(stored?.agents ?? [])].map((agent) => [agent.id, agent]));
    for (const [id, entry] of active) {
      const previous = rows.get(id);
      rows.set(id, previous?.lastActivityAt != null && previous.lastActivityAt > entry.latestAt!
        ? previous
        : { id, lastActivityAt: entry.latestAt, model: entry.latestModel });
    }
    const activity = await prepareCodingActivity(source, {
      collectedAt: Math.max(receivedAt, stored?.collectedAt ?? 0),
      agents: [...rows.values()].sort((left, right) => left.id.localeCompare(right.id)),
    }, receivedAt);
    staged.push(activity.stage);
    if (activity.event) events.push(activity.event);
  }

  const movedBuckets = move.carry ? moved : [...books.keys()].filter((id) => move.ids.includes(id));
  if (movedBuckets.length) {
    const without = await prepareBucketsWithout(move.from, movedBuckets);
    staged.push(without.stage);
    if (move.carry) deltas.push(...without.removed);
  }
  const buckets = await prepareOtlpBuckets(source, deltas, receivedAt);
  staged.push(buckets.stage);

  const batch = getStorage().batch().set(codingOtlpKey(source), JSON.stringify(nextCounters));
  // 会话数跟着日行一起搬走，否则旧来源下次写这个 agent 时会把搬走的会话数再算一遍。
  if (fromOtlp && fromCounters && moved.length) {
    const sessionCountsLeft = Object.fromEntries(Object.entries(fromCounters.sessionCounts).filter(([id]) => !moved.includes(id as OtlpAgentId)));
    batch.set(codingOtlpKey(fromOtlp), JSON.stringify({ ...fromCounters, sessionCounts: sessionCountsLeft }));
  }
  for (const stage of staged) stage(batch);
  const write = batch.execute();
  await fanout({ writes: [write], events, tags });
  return { accepted: points.length - skippedDelta };
}
