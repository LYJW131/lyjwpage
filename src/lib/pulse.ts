import { readPulseAssessments } from "@/lib/pulse-assessments";
import { summarizeAssessments, type PulseAssessment } from "@shared/pulse-assessment";
import {
  PULSE_REPEAT_AFTER_MS,
  PULSE_SILENT_AFTER_MS,
  PULSE_HINT_MAX,
} from "@/lib/limits";
import { CHARGING_IDLE_MAX_W } from "@/lib/home-layout";
import { toAssessmentColumns, toSegmentColumns } from "@/lib/pulse-columns";
import { pulseWindowAt } from "@/lib/pulse-window";
import { key, withStorage } from "@/lib/storage";
import {
  PULSE_DOMAINS,
  type PulseDomain,
  type PulseHistory,
  type PulseLevel,
  type PulsePayload,
  type PulsePublicAssessment,
  type PulseSpan,
  type PulseSample,
  type PulseSeries,
} from "@/lib/types";

export function pulseKey(domain: PulseDomain): string {
  return key("pulse", domain);
}

export function pulseIntervalRangeKey(domain: "activity"): string {
  return key("pulse", domain, "authoritative-range");
}

export function pulseIntervalRevisionKey(domain: "activity"): string {
  return key("pulse", domain, "revision");
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
  // 瓦数留一位小数：泳道和评分都用不上固件那两位，多出来的只会让每封读数都「不一样」
  const powerW = next.powerW != null ? Math.round(next.powerW * 10) / 10 : undefined;
  return { t: next.t, level: next.level, ...(powerW != null ? { powerW } : {}), ...(next.until != null ? { until: next.until } : {}), ...(hint ? { hint } : {}) };
}

/**
 * 这一帧该不该进 samples 表。纯函数，不碰存储。
 *
 * - 没有上一笔 → 写入（含空闲：空闲也得有一条，后面才知道「从何时起没事」）。
 * - `t` 不前进 → 丢掉。这是源站 receivedAt，同一 StateHub 上单调；≤ 就是重复或乱序。
 * - 带 until 的已完成区间 → 写入，包括相邻同档和空闲，不能丢失终点。
 * - level 或 hint 变了 → 写入（状态翻面）。
 * - 瓦数：跨过待机门槛（CHARGING_IDLE_MAX_W）立刻写；门槛以下的抖动不写——插着线
 *   不在充时读数在 0 和 0.5 W 之间约 40 秒跳一次，从前每跳一次记一条，占了充电
 *   泳道八成；都在通电时至少隔 30 秒，且变得够明显（≥ 2 W 且 ≥ 10%）才写。
 *   小幅漂移由 5 分钟再确认那一笔带上最新读数。跨档由上面的 level 接住。
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
  // Power changes are sampled at most once per 30 seconds; crossing the idle threshold is immediate.
  if (sample.powerW != null && last.powerW != null && sample.powerW !== last.powerW &&
      sample.powerW > CHARGING_IDLE_MAX_W && last.powerW > CHARGING_IDLE_MAX_W && sample.t - last.t < 30_000) return null;
  if (sample.level !== last.level || sample.hint !== last.hint || powerMoved(last.powerW, sample.powerW)) {
    return sample;
  }
  if (sample.t - last.t >= PULSE_REPEAT_AFTER_MS) {
    return sample;
  }
  return null;
}

function powerMoved(before: number | undefined, after: number | undefined): boolean {
  if (before === after) return false;
  if (before == null || after == null) return true;
  const idleBefore = before <= CHARGING_IDLE_MAX_W;
  if (idleBefore !== after <= CHARGING_IDLE_MAX_W) return true;
  if (idleBefore) return false;
  return Math.abs(after - before) >= Math.max(2, 0.1 * Math.max(before, after));
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
    const assessments = rows.filter((r)=>r.domain===domain);
    const score = summarizeAssessments(assessments, window.from, window.to);
    if (domain === "watching" || domain === "gaming" || domain === "charging") {
      domains[domain] = { ...measuredPulseView(domain, history.series[domain].samples, window), score };
      continue;
    }
    /**
     * Listening 画评分，不画实测。
     *
     * 实测那条线只看得见 Mac 和 HomePod：在 iPhone 或别的设备上放一整天，它也是
     * 平的。而那些设备唯一留下的痕迹是「最近在听」列表的变动，它没有时刻，只有
     * 评分那一侧收得到（见 shared/pulse-listening）。画评分等于把两路证据都画上，
     * 画实测等于只画其中一路还看不出另一路缺席。Watching / Gaming / Charging
     * 没有这个盲区，仍画实测。
     */
    domains[domain] = { kind: "score", score, assessments: toAssessmentColumns(assessments.map((row) =>
      publicAssessment(row, window, domain === "listening" ? assessmentTitle(history.series.listening.samples, row) : undefined),
    )) };
  }
  return { generatedAt: now, window, domains };
}

/** 窗口内的绝对区间 → 相对 `window.from` 的整秒，见 PulseSpan */
export function pulseSpan(window: { from: number }, from: number, to: number): PulseSpan {
  return { startSec: Math.round((from - window.from) / 1000), endSec: Math.round((to - window.from) / 1000) };
}

/** 评分行的公开投影，字段取舍见 PulsePublicAssessment */
export function publicAssessment(row: PulseAssessment, window: { from: number }, title?: string): PulsePublicAssessment {
  const whole = row.coverage.length === 1 && row.coverage[0].from === row.from && row.coverage[0].to === row.to;
  return {
    ...pulseSpan(window, row.from, row.to),
    ...(whole ? {} : { coverage: row.coverage.map((part) => pulseSpan(window, part.from, part.to)) }),
    intensity: { value: row.intensity.value, confidence: Math.round(row.intensity.confidence * 100) / 100 },
    continuity: { value: row.continuity.value },
    mode: row.mode ? { value: row.mode.value } : null,
    ...(title ? { title } : {}),
  };
}

/**
 * 评分窗口里在放的那首歌。分数本身不带名字，而展开卡从前在实测段上就显示它
 * （和实测段同一份 hint、同一个公开口径），换成评分线之后不该跟着消失。
 * 取窗口内占时最长的那一首；只认 level ≥ 2，停了不沿用旧标题。
 */
function assessmentTitle(samples: PulseSample[], window: { from: number; to: number }): string | undefined {
  let longest: { title: string; ms: number } | null = null;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    if (sample.level < 2 || !sample.hint) continue;
    const from = Math.max(window.from, sample.t);
    const to = Math.min(window.to, samples[index + 1]?.t ?? window.to, pulseSampleUntil("listening", sample));
    if (to - from > (longest?.ms ?? 0)) longest = { title: sample.hint, ms: to - from };
  }
  return longest?.title;
}

/** Validity follows each producer's cadence and event semantics. */
export function pulseSampleUntil(domain: PulseDomain, sample: PulseSample): number {
  if (sample.until != null) return sample.until;
  // Emby emits an explicit stop once; it remains stopped until the next playback event.
  if (domain === "watching" && sample.level === 0) return Infinity;
  // PSN's no-visitor polling cadence is 30 minutes; allow five minutes of delivery jitter.
  return sample.t + (domain === "gaming" ? 35 * 60_000 : PULSE_SILENT_AFTER_MS);
}

/** Preserve source boundaries and silence, including observed zero values. */
export function measuredPulseView(domain: "listening" | "watching" | "gaming" | "charging", samples: PulseSample[], window: { from: number; to: number }): import("@/lib/types").PulseChartView {
  // 先按绝对毫秒合并相邻同值段，出口处再换成相对秒
  const merged: { from: number; to: number; value: number; title?: string }[] = [];
  for (let i = 0; i < samples.length; i++) {
    const sample = samples[i];
    const from = Math.max(window.from, sample.t);
    const to = Math.min(window.to, samples[i + 1]?.t ?? window.to, pulseSampleUntil(domain, sample));
    const value = domain === "charging" ? sample.powerW : sample.level === 3 ? 1 : 0;
    if (to <= from || value == null) continue;
    // Only media/game labels are public; stopped sessions must not inherit their old title.
    const title = domain !== "charging" && sample.level >= 2 ? sample.hint : undefined;
    const previous = merged.at(-1);
    if (previous?.to === from && previous.value === value && previous.title === title) previous.to = to;
    else merged.push({ from, to, value, ...(title ? { title } : {}) });
  }
  const segments = toSegmentColumns(merged.map(({ from, to, ...rest }) => ({ ...pulseSpan(window, from, to), ...rest })));
  if (domain === "charging") {
    const last = samples.at(-1);
    return { kind: "power", segments, currentPowerW: last && last.t <= window.to && window.to < (last.until ?? last.t + PULSE_SILENT_AFTER_MS) ? last.powerW ?? null : null };
  }
  return { kind: "binary", segments, activeSeconds: merged.reduce((sum, part) => sum + (part.value === 1 ? (part.to - part.from) / 1000 : 0), 0) };
}
