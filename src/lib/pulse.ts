import {
  PULSE_REPEAT_AFTER_MS,
  PULSE_HINT_MAX,
} from "@/lib/limits";
import { key, withStorage } from "@/lib/storage";
import {
  PULSE_DOMAINS,
  type PulseDomain,
  type PulseHistory,
  type PulseLevel,
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
    const row = value as { t?: unknown; level?: unknown; hint?: unknown };
    if (typeof row.t !== "number" || !Number.isFinite(row.t) || !isPulseLevel(row.level)) {
      return null;
    }
    const hint = normalizeHint(typeof row.hint === "string" ? row.hint : undefined);
    return hint ? { t: row.t, level: row.level, hint } : { t: row.t, level: row.level };
  } catch {
    return null;
  }
}

export function toPulseSample(next: {
  t: number;
  level: PulseLevel;
  hint?: string | null;
}): PulseSample {
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
export function planPulseSample(
  last: PulseSample | null,
  next: { t: number; level: PulseLevel; hint?: string | null },
): PulseSample | null {
  const sample = toPulseSample(next);
  if (!last) return sample;
  if (sample.t <= last.t) return null;
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
 * 五域一次读完。键不存在就是空数组；坏行跳过。
 *
 * `cursor` 按域各自切片：有的域还没数据、有的已经裁过最旧点，partial 标志互不影响。
 * 这是 Worker 内部读形状，没有公开 HTTP。
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
