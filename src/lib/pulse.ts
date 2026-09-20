import {
  PULSE_REPEAT_AFTER_MS,
  PULSE_HINT_MAX,
  PULSE_SCORE_MAX_AGE_MS,
} from "@/lib/limits";
import { clipPulseSamples, pulseWindowAt } from "@/lib/pulse-window";
import { askStorage, key, withStorage } from "@/lib/storage";
import {
  PULSE_DOMAINS,
  PULSE_TRENDS,
  type PulseDomain,
  type PulseHistory,
  type PulseLevel,
  type PulsePayload,
  type PulseSample,
  type PulseScoreRecord,
  type PulseSeries,
  type PulseTrend,
} from "@/lib/types";

export function pulseKey(domain: PulseDomain): string {
  return key("pulse", domain);
}

/** 评分器写的那一份，各域同一个键、一份 JSON，不设 TTL。 */
export function pulseScoresKey(): string {
  return key("pulse", "scores");
}

/** 上一次向网关**尝试**的时刻（epoch 毫秒字符串）。失败也记，节流才不随 DO 重启归零。 */
export function pulseScoreAttemptKey(): string {
  return `${pulseScoresKey()}:attempt`;
}

function normalizeHint(hint: string | null | undefined): string | undefined {
  if (typeof hint !== "string") return undefined;
  const trimmed = hint.trim().slice(0, PULSE_HINT_MAX);
  return trimmed || undefined;
}

function isPulseLevel(value: unknown): value is PulseLevel {
  return value === 0 || value === 1 || value === 2 || value === 3;
}

/** 脏行丢掉，不因为一条坏 JSON 废掉整条序列。 */
export function parsePulseSample(raw: string): PulseSample | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const row = value as { t?: unknown; level?: unknown; hint?: unknown; until?: unknown };
    if (typeof row.t !== "number" || !Number.isFinite(row.t) || !isPulseLevel(row.level)) {
      return null;
    }
    if (row.until != null && (typeof row.until !== "number" || !Number.isFinite(row.until) || row.until <= row.t)) return null;
    const interval = typeof row.until === "number" ? { until: row.until } : {};
    const hint = normalizeHint(typeof row.hint === "string" ? row.hint : undefined);
    return { t: row.t, level: row.level, ...interval, ...(hint ? { hint } : {}) };
  } catch {
    return null;
  }
}

export function toPulseSample(next: {
  t: number;
  level: PulseLevel;
  hint?: string | null;
  until?: number;
}): PulseSample {
  const hint = normalizeHint(next.hint);
  return { t: next.t, level: next.level, ...(next.until != null ? { until: next.until } : {}), ...(hint ? { hint } : {}) };
}

/**
 * 这一帧该不该进 samples 表。纯函数，不碰存储。
 *
 * - 没有上一笔 → 写入（含空闲：空闲也得有一条，后面才知道「从何时起没事」）。
 * - `t` 不前进 → 丢掉。这是源站 receivedAt，同一 StateHub 上单调；≤ 就是重复或乱序。
 * - 带 until 的已完成区间 → 写入，包括相邻同档和空闲，不能丢失终点。
 * - level 或 hint 变了 → 写入（状态翻面）。
 * - 非空闲且距上一笔 ≥ 5 分钟 → 写入。序列是阶跃函数，每个点撑到下一个；
 *   隔这么久再确认一次，上报器死了会在图上露出缺口。
 * - 其余 → 丢掉。空闲保持单点；5 分钟内没变的非空闲心跳不得灌表。
 */
export function planPulseSample(
  last: PulseSample | null,
  next: { t: number; level: PulseLevel; hint?: string | null; until?: number },
): PulseSample | null {
  const sample = toPulseSample(next);
  if (!last) return sample;
  if (sample.t <= last.t) return null;
  if (sample.until != null) return sample;
  if (sample.level !== last.level || sample.hint !== last.hint) {
    return sample;
  }
  if (sample.level > 0 && sample.t - last.t >= PULSE_REPEAT_AFTER_MS) {
    return sample;
  }
  return null;
}

/**
 * 按游标切一条域的序列。规则同充电头 `sliceChargerHistory`：
 * 只有游标不早于还留着的最旧点时增量才连续，否则整份重发。
 */
export function slicePulseSeries(
  samples: PulseSample[],
  cursor?: number,
): PulseSeries {
  const oldest = samples[0] ?? null;
  const partial = cursor != null && oldest != null && cursor >= oldest.t;
  return {
    samples: partial ? samples.filter((sample) => sample.t > cursor) : samples,
    partial,
  };
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

/**
 * 各域一次读完。键不存在就是空数组；坏行跳过。
 *
 * `cursor` 按域各自切片：有的域还没数据、有的已经裁过最旧点，partial 标志互不影响。
 * 内部读形状；公开那份由下面的 getPulseStatus 裁窗、剥 hint 之后给出。
 */
export async function readPulseHistory(cursor?: number): Promise<PulseHistory> {
  const rows = await withStorage(async (storage) => {
    const pipe = storage.batch();
    for (const domain of PULSE_DOMAINS) {
      pipe.listRange(pulseKey(domain), 0, -1);
    }
    return pipe.execute();
  }, PULSE_DOMAINS.map(() => [] as string[]));

  const series = {} as Record<PulseDomain, PulseSeries>;
  PULSE_DOMAINS.forEach((domain, index) => {
    const samples: PulseSample[] = [];
    for (const raw of asStringList(rows[index])) {
      const sample = parsePulseSample(raw);
      if (sample) samples.push(sample);
    }
    series[domain] = slicePulseSeries(samples, cursor);
  });
  return { series };
}


function isTrend(value: unknown): value is PulseTrend {
  return typeof value === "string" && (PULSE_TRENDS as readonly string[]).includes(value);
}

/**
 * 解析存着的那份评分。坏了就当没有 —— 卡片显示「还没打分」，
 * 好过把半份数据画成分数。评分器和读路径共用这一份校验。
 */
export function parsePulseScoreRecord(raw: string | null): PulseScoreRecord | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object") return null;
    const row = value as Partial<PulseScoreRecord>;
    if (typeof row.scoredAt !== "number" || !Number.isFinite(row.scoredAt)) return null;
    if (!row.window || typeof row.window.from !== "number" || typeof row.window.to !== "number") return null;
    const domains = {} as PulseScoreRecord["domains"];
    for (const domain of PULSE_DOMAINS) {
      const entry = row.domains?.[domain];
      if (!entry || typeof entry.score !== "number" || !Number.isFinite(entry.score) || !isTrend(entry.trend)) {
        return null;
      }
      domains[domain] = {
        score: entry.score,
        confidence: typeof entry.confidence === "number" && Number.isFinite(entry.confidence) ? entry.confidence : null,
        trend: entry.trend,
        latestSampleAt: typeof entry.latestSampleAt === "number" ? entry.latestSampleAt : null,
      };
    }
    return { scoredAt: row.scoredAt, window: { from: row.window.from, to: row.window.to }, domains };
  } catch {
    return null;
  }
}

export async function readPulseScores(): Promise<PulseScoreRecord | null> {
  const answered = await askStorage((storage) => storage.get(pulseScoresKey()));
  return answered.reachable ? parsePulseScoreRecord(answered.value) : null;
}

/**
 * 公开端点 `/api/status/pulse` 的取数。
 *
 * 各域各裁最近 24 小时（外加窗口左边界之前那一笔，压到 from，泳道才从头填满），
 * **hint 一律不出来**；分从 `pulse:scores` 读，没有就是 null。
 * 分自带自己的窗口，和这次裁的窗口不必相同 —— 它最多十分钟前才打过一次。
 */
export async function getPulseStatus(now: number = Date.now()): Promise<PulsePayload> {
  const [history, stored] = await Promise.all([readPulseHistory(), readPulseScores()]);
  const window = pulseWindowAt(now);
  // 过老的分不展示：它评的是早已滑走的窗口，配着空泳道只会误导
  const scores = stored && now - stored.scoredAt <= PULSE_SCORE_MAX_AGE_MS ? stored : null;
  const domains = {} as PulsePayload["domains"];
  for (const domain of PULSE_DOMAINS) {
    const scored = scores?.domains[domain];
    domains[domain] = {
      samples: clipPulseSamples(history.series[domain].samples, window),
      score: scored
        ? {
            value: scored.score,
            confidence: scored.confidence,
            trend: scored.trend,
            scoredAt: scores.scoredAt,
          }
        : null,
    };
  }
  return { generatedAt: now, window, domains };
}
