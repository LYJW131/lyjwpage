import {
  ACTIVITY_HISTORY_REPEAT_AFTER_MS,
  ACTIVITY_HINT_MAX,
} from "@/lib/limits";
import { key, withStorage } from "@/lib/storage";
import {
  ACTIVITY_DOMAINS,
  type ActivityDomain,
  type ActivityDomainSeries,
  type ActivityHistoryPayload,
  type ActivityLevel,
  type ActivitySample,
} from "@/lib/types";

export function activityHistoryKey(domain: ActivityDomain): string {
  return key("activity-history", domain);
}

function normalizeHint(hint: string | null | undefined): string | undefined {
  if (typeof hint !== "string") return undefined;
  const trimmed = hint.trim().slice(0, ACTIVITY_HINT_MAX);
  return trimmed || undefined;
}

function isActivityLevel(value: unknown): value is ActivityLevel {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

/** 脏行丢掉，不因为一条坏 JSON 废掉整条序列。 */
export function parseActivitySample(raw: string): ActivitySample | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const row = value as { t?: unknown; level?: unknown; hint?: unknown };
    if (typeof row.t !== "number" || !Number.isFinite(row.t) || !isActivityLevel(row.level)) {
      return null;
    }
    const hint = normalizeHint(typeof row.hint === "string" ? row.hint : undefined);
    return hint ? { t: row.t, level: row.level, hint } : { t: row.t, level: row.level };
  } catch {
    return null;
  }
}

export function toActivitySample(next: {
  t: number;
  level: ActivityLevel;
  hint?: string | null;
}): ActivitySample {
  const hint = normalizeHint(next.hint);
  return hint ? { t: next.t, level: next.level, hint } : { t: next.t, level: next.level };
}

/**
 * 这一帧该不该进 samples 表。纯函数，不碰存储。
 *
 * - 没有上一笔 → 写入（含空闲：空闲也得有一条，后面才知道「从何时起没事」）。
 * - `t` 不前进 → 丢掉。这是源站 receivedAt，同一 StateHub 上单调；≤ 就是重复或乱序。
 * - level 或 hint 变了 → 写入（状态翻面）。
 * - 非空闲且距上一笔 ≥ 5 分钟 → 写入。序列是阶跃函数，每个点撑到下一个；
 *   隔这么久再确认一次，上报器死了会在图上露出缺口。
 * - 其余 → 丢掉。空闲保持单点；5 分钟内没变的非空闲心跳不得灌表。
 */
export function planActivitySample(
  last: ActivitySample | null,
  next: { t: number; level: ActivityLevel; hint?: string | null },
): ActivitySample | null {
  const sample = toActivitySample(next);
  if (!last) return sample;
  if (sample.t <= last.t) return null;
  if (sample.level !== last.level || sample.hint !== last.hint) {
    return sample;
  }
  if (sample.level > 0 && sample.t - last.t >= ACTIVITY_HISTORY_REPEAT_AFTER_MS) {
    return sample;
  }
  return null;
}

/**
 * 按客户端游标切一条域的历史。规则同充电头 `sliceChargerHistory`：
 * 只有 since 不早于还留着的最旧点时增量才连续，否则整份重发。
 */
export function sliceActivitySeries(
  samples: ActivitySample[],
  since?: number,
): ActivityDomainSeries {
  const oldest = samples[0] ?? null;
  const partial = since != null && oldest != null && since >= oldest.t;
  return {
    samples: partial ? samples.filter((sample) => sample.t > since) : samples,
    partial,
  };
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/**
 * 五域一次读完。键不存在就是空数组；坏行跳过。
 *
 * `since` 按域各自切片：有的域还没数据、有的已经裁过最旧点，partial 标志互不影响。
 */
export async function readActivityHistory(since?: number): Promise<ActivityHistoryPayload> {
  const rows = await withStorage(async (storage) => {
    const pipe = storage.batch();
    for (const domain of ACTIVITY_DOMAINS) {
      pipe.listRange(activityHistoryKey(domain), 0, -1);
    }
    return pipe.execute();
  }, ACTIVITY_DOMAINS.map(() => [] as string[]));

  const series = {} as Record<ActivityDomain, ActivityDomainSeries>;
  ACTIVITY_DOMAINS.forEach((domain, index) => {
    const samples: ActivitySample[] = [];
    for (const raw of asStringList(rows[index])) {
      const sample = parseActivitySample(raw);
      if (sample) samples.push(sample);
    }
    series[domain] = sliceActivitySeries(samples, since);
  });
  return { series };
}
