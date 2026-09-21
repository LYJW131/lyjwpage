import { readPulseAssessments } from "@/lib/pulse-assessments";
import { summarizeAssessments } from "@shared/pulse-assessment";
import {
  PULSE_REPEAT_AFTER_MS,
  PULSE_SILENT_AFTER_MS,
  PULSE_HINT_MAX,
} from "@/lib/limits";
import { pulseWindowAt } from "@/lib/pulse-window";
import { key, withStorage } from "@/lib/storage";
import {
  PULSE_DOMAINS,
  type PulseDomain,
  type PulseHistory,
  type PulseLevel,
  type PulsePayload,
  type PulseSample,
  type PulseSeries,
} from "@/lib/types";

export function pulseKey(domain: PulseDomain): string {
  return key("pulse", domain);
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
    const row = value as { t?: unknown; level?: unknown; hint?: unknown; until?: unknown; powerW?: unknown };
    if (typeof row.t !== "number" || !Number.isFinite(row.t) || !isPulseLevel(row.level)) {
      return null;
    }
    if (row.until != null && (typeof row.until !== "number" || !Number.isFinite(row.until) || row.until <= row.t)) return null;
    if (row.powerW != null && (typeof row.powerW !== "number" || !Number.isFinite(row.powerW) || row.powerW < 0)) return null;
    const power = typeof row.powerW === "number" ? { powerW: row.powerW } : {};
    const interval = typeof row.until === "number" ? { until: row.until } : {};
    const hint = normalizeHint(typeof row.hint === "string" ? row.hint : undefined);
    return { t: row.t, level: row.level, ...interval, ...power, ...(hint ? { hint } : {}) };
  } catch {
    return null;
  }
}

export function toPulseSample(next: {
  t: number;
  level: PulseLevel;
  hint?: string | null;
  until?: number;
  powerW?: number;
}): PulseSample {
  const hint = normalizeHint(next.hint);
  return { t: next.t, level: next.level, ...(next.powerW != null ? { powerW: next.powerW } : {}), ...(next.until != null ? { until: next.until } : {}), ...(hint ? { hint } : {}) };
}

/**
 * 这一帧该不该进 samples 表。纯函数，不碰存储。
 *
 * - 没有上一笔 → 写入（含空闲：空闲也得有一条，后面才知道「从何时起没事」）。
 * - `t` 不前进 → 丢掉。这是源站 receivedAt，同一 StateHub 上单调；≤ 就是重复或乱序。
 * - 带 until 的已完成区间 → 写入，包括相邻同档和空闲，不能丢失终点。
 * - level 或 hint 变了 → 写入（状态翻面）。
 * - 距上一笔 ≥ 5 分钟 → 写入。序列是阶跃函数，每个点撑到下一个；
 *   隔这么久再确认一次，上报器死了会在图上露出缺口。
 * - 其余 → 丢掉。空闲也保留五分钟心跳，评分时才能区分空闲与缺报。
 */
export function planPulseSample(
  last: PulseSample | null,
  next: { t: number; level: PulseLevel; hint?: string | null; until?: number; powerW?: number },
): PulseSample | null {
  const sample = toPulseSample(next);
  if (!last) return sample;
  if (sample.t <= last.t) return null;
  if (sample.until != null) return sample;
  // Power changes are sampled at most once per 30 seconds; zero/nonzero transitions are immediate.
  if (sample.powerW != null && last.powerW != null && sample.powerW !== last.powerW &&
      sample.powerW > 0 && last.powerW > 0 && sample.t - last.t < 30_000) return null;
  if (sample.level !== last.level || sample.hint !== last.hint || sample.powerW !== last.powerW) {
    return sample;
  }
  if (sample.t - last.t >= PULSE_REPEAT_AFTER_MS) {
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


/** Graph and summary share the same immutable observations and revision-aware assessments. */
export async function getPulseStatus(now: number = Date.now()): Promise<PulsePayload> {
  const window = pulseWindowAt(now);
  const [rows, history] = await Promise.all([readPulseAssessments(window.from, window.to), readPulseHistory()]);
  const domains = {} as PulsePayload['domains'];
  for (const domain of PULSE_DOMAINS) {
    if (domain !== "coding" && domain !== "activity") {
      domains[domain] = measuredPulseView(domain, history.series[domain].samples, window);
      continue;
    }
    const assessments = rows.filter((r)=>r.domain===domain);
    domains[domain] = { kind: "score", assessments, score: summarizeAssessments(assessments, window.from, window.to) };
  }
  return { generatedAt: now, window, domains };
}

/** Preserve source boundaries and silence, including observed zero values. */
export function measuredPulseView(domain: "listening" | "watching" | "gaming" | "charging", samples: PulseSample[], window: { from: number; to: number }): import("@/lib/types").PulseDomainView {
  const segments: import("@/lib/types").PulseMeasuredSegment[] = [];
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    const from = Math.max(window.from, sample.t);
    const to = Math.min(window.to, samples[i + 1]?.t ?? window.to, sample.until ?? sample.t + PULSE_SILENT_AFTER_MS);
    const value = domain === "charging" ? sample.powerW : sample.level === 3 ? 1 : 0;
    if (to <= from || value == null) continue;
    const previous = segments.at(-1);
    if (previous?.to === from && previous.value === value) previous.to = to;
    else segments.push({ from, to, value });
  }
  if (domain === "charging") {
    const last = samples.at(-1);
    return { kind: "power", segments, currentPowerW: last && last.t <= window.to && window.to < (last.until ?? last.t + PULSE_SILENT_AFTER_MS) ? last.powerW ?? null : null };
  }
  return { kind: "binary", segments, activeSeconds: segments.reduce((sum, part) => sum + (part.value === 1 ? (part.to - part.from) / 1000 : 0), 0) };
}
