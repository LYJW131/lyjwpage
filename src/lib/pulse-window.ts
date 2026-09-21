import {
  PULSE_SILENT_AFTER_MS,
  PULSE_WINDOW_MS,
} from "@/lib/limits";
import {
  PULSE_LEVEL_MAX,
  type PulseLevel,
  type PulseSample,
} from "@/lib/types";

/**
 * 把 pulse 的阶跃序列裁成一个时间窗。
 *
 * 评分器不再读它（各域改在 shared/pulse-features 里压成命名秒数）；留给 activity 的
 * 区间裁剪测试和任何还要按段看序列的地方。hint 仅内部使用；公开端点只读模型评估。
 *
 * 纯函数，不碰存储、不看时钟：`now` 一律由调用方传进来，测试才排得出确定的窗口。
 */

/** 一段连续同档。段与段之间留出的空当就是上报静默，不另起一个字段去标它。 */
export type PulseSegment = {
  from: number;
  to: number;
  level: PulseLevel;
  hint?: string;
};

export type PulseWindow = { from: number; to: number };

export type PulseDomainWindow = {
  segments: PulseSegment[];
  /** 每档各占多少分钟，下标就是档位；四个数加起来不必等于窗口长度（静默不计入）。 */
  minutesByLevel: number[];
  /** 该域最新那笔样本的 `t`（可能早于窗口），没有样本时为 null。 */
  latestSampleAt: number | null;
};

export function pulseWindowAt(now: number): PulseWindow {
  return { from: now - PULSE_WINDOW_MS, to: now };
}

/**
 * 一笔样本撑到什么时候。
 *
 * 非空闲每 5 分钟就该再确认一次（PULSE_REPEAT_AFTER_MS），所以超过两倍还没有
 * 下一笔就是上报器静默，那段如实空着，不拿旧值糊满整夜。空闲不设上限：
 * 空闲本来就只留一个点，它撑到下一次翻面才是它的语义。
 * activity 为已完成的估算区间，所有档位都在 until 截止，不套用实时心跳上限。
 */
function heldUntil(sample: PulseSample, nextAt: number): number {
  if (sample.until != null) return Math.min(sample.until, nextAt);
  if (sample.level === 0) return nextAt;
  return Math.min(nextAt, sample.t + PULSE_SILENT_AFTER_MS);
}

/**
 * 压成段。样本按 `t` 递增（写入侧保证），这里只做裁剪与合并：
 *
 * - 窗口左边界之前的最后一笔照样算，段的起点裁到 `from` —— 不然泳道左边会空一截；
 * - 相邻同档同 hint 的段并成一段，静默造成的断口不并；
 * - 最后一笔撑到 `to`（或静默上限，取小）。
 */
export function compressPulseWindow(
  samples: PulseSample[],
  window: PulseWindow,
): PulseDomainWindow {
  const latestSampleAt = samples.length ? samples[samples.length - 1].t : null;
  const minutesByLevel = new Array<number>(PULSE_LEVEL_MAX + 1).fill(0);
  const segments: PulseSegment[] = [];

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const nextAt = index + 1 < samples.length ? samples[index + 1].t : window.to;
    const from = Math.max(sample.t, window.from);
    const to = Math.min(heldUntil(sample, nextAt), window.to);
    if (to <= from) continue;

    const previous = segments[segments.length - 1];
    if (previous && previous.to === from && previous.level === sample.level && previous.hint === sample.hint) {
      previous.to = to;
    } else {
      segments.push(sample.hint ? { from, to, level: sample.level, hint: sample.hint } : { from, to, level: sample.level });
    }
    minutesByLevel[sample.level] += (to - from) / 60_000;
  }

  return {
    segments,
    minutesByLevel: minutesByLevel.map((minutes) => Math.round(minutes)),
    latestSampleAt,
  };
}
