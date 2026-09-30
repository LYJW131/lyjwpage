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
  const answered = await askStorage((storage) => storage.batch().get(codingOtlpKey()).fields(codingUsageKey("agents-otlp")).execute());
  if (!answered.reachable) throw new Error("云端用量计数器读不到");
  const counters = parseOtlpCounters(answered.value[0]);
  const ledger = parseStoredUsageLedgers(answered.value[1]).claude;

  const series = { ...(counters?.series ?? {}) };
  const sessions = { ...(counters?.sessions ?? {}) };
  let sessionCount = counters?.sessionCount ?? 0;
  const days = new Map((ledger?.days ?? []).map((day) => [day.date, { ...day, models: day.models.map((row) => ({ ...row })) }]));
  const deltas: CodingBucketDelta[] = [];
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

  if (changed || sessionCount !== (ledger?.sessionCount ?? 0)) {
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
    const usage = await prepareCodingUsage("agents-otlp", { agents: [agent] }, receivedAt, { derived: true });
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
