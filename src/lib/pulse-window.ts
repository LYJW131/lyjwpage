import {
  PULSE_SILENT_AFTER_MS,
  PULSE_WINDOW_MS,
} from "@/lib/limits";
import {
  PULSE_DOMAINS,
  PULSE_LEVEL_MAX,
  type PulseDomain,
  type PulseLevel,
  type PulseSample,
} from "@/lib/types";

/**
 * 把 pulse 的阶跃序列裁成一个时间窗，给两个消费者用：
 *
 * - 公开端点 `/api/status/pulse`（`clipPulseSamples`）—— 只有 `{ t, level }`，hint 剥掉；
 * - Jev 评分器（`buildPulseState`）—— 段 + 每档分钟数，hint 留着，只在 Worker 内部走。
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
 */
function heldUntil(sample: PulseSample, nextAt: number): number {
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

/**
 * 公开端点那份：窗口内的点，加上窗口左边界之前的最后一笔（`t` 裁到 `from`）。
 * hint 一律剥掉 —— 它不出公网，理由见 PulsePayload。
 *
 * 边界之前那一笔要**还撑得到窗口里**才留：一条昨天夜里就停在「正在放」的陈旧样本
 * 早过了静默上限，段压器（`compressPulseWindow`，也就是 Jev 看到的那份）对它什么都
 * 不画，泳道也不该在左沿糊出一段没发生过的活动。空闲不受此限，它本来就撑到下一次翻面。
 */
export function clipPulseSamples(
  samples: PulseSample[],
  window: PulseWindow,
): { t: number; level: PulseLevel }[] {
  const clipped: { t: number; level: PulseLevel }[] = [];
  for (const sample of samples) {
    if (sample.t > window.to) break;
    if (sample.t < window.from) {
      // 边界之前的只留最后一笔，压在 from 上；撑不进来的连这一笔也不留
      clipped.length = 0;
      if (heldUntil(sample, window.to) > window.from) {
        clipped.push({ t: window.from, level: sample.level });
      }
      continue;
    }
    clipped.push({ t: sample.t, level: sample.level });
  }
  return clipped;
}

/** 档位在各域分别是什么意思。进 Jev 的 state，让它知道 3 不是「分」而是档。 */
export const PULSE_LEGEND: Readonly<Record<PulseDomain, string>> = Object.freeze({
  coding: "0 idle, 2 a coding app in front, 3 an agent actively working",
  listening: "0 idle, 2 paused, 3 playing",
  watching: "0 idle, 2 paused, 3 playing",
  gaming: "0 offline, 1 console online, 3 in a game",
  charging: "0 unplugged, 1 trickle, 2 up to 60W, 3 60W or more",
});

type JevQuestion =
  | { type: "score"; instructions: string; criteria: string[] }
  | { type: "choice"; instructions: string; criteria: Record<string, string> };

/** 活动分的四档标尺，低到高。Jev 在下标之间插值，所以卡片上的分就是 0–3。 */
export const PULSE_SCORE_CRITERIA = Object.freeze([
  "idle: no activity",
  "light: brief or occasional activity",
  "moderate: regular activity for a meaningful part of the day",
  "intense: sustained high activity for much of the day",
]);

const TREND_CRITERIA = Object.freeze({
  rising: "more active in the most recent hours than earlier",
  steady: "about the same",
  falling: "less active recently than earlier",
});

export function activityQuestionKey(domain: PulseDomain): string {
  return `${domain}Activity`;
}
export function trendQuestionKey(domain: PulseDomain): string {
  return `${domain}Trend`;
}

/** 五个域十道题，一次问完。 */
export function pulseQuestions(): Record<string, JevQuestion> {
  const questions: Record<string, JevQuestion> = {};
  for (const domain of PULSE_DOMAINS) {
    questions[activityQuestionKey(domain)] = {
      type: "score",
      instructions: `How active was ${domain} over the last 24 hours?`,
      criteria: [...PULSE_SCORE_CRITERIA],
    };
    questions[trendQuestionKey(domain)] = {
      type: "choice",
      instructions: `Compared with earlier in the window, how is ${domain} trending in the most recent hours?`,
      criteria: { ...TREND_CRITERIA },
    };
  }
  return questions;
}

/**
 * 喂给 Jev 的那份 state。
 *
 * 时刻写成「距窗口起点多少分钟」而不是 ISO：紧凑、和窗口自洽，模型也不用去解时区。
 * 段之外还给每档的分钟数 —— 让它从数字上读出「有多少」，不必去数一串区间。
 */
export function buildPulseState(
  windows: Record<PulseDomain, PulseDomainWindow>,
  window: PulseWindow,
): Record<string, unknown> {
  const minutesFrom = (at: number) => Math.round((at - window.from) / 60_000);
  return {
    window: { hours: Math.round((window.to - window.from) / 3_600_000), unit: "minutes from window start" },
    legend: PULSE_LEGEND,
    domains: Object.fromEntries(PULSE_DOMAINS.map((domain) => {
      const view = windows[domain];
      return [domain, {
        minutesByLevel: view.minutesByLevel,
        segments: view.segments.map((segment) => segment.hint
          ? [minutesFrom(segment.from), minutesFrom(segment.to), segment.level, segment.hint]
          : [minutesFrom(segment.from), minutesFrom(segment.to), segment.level]),
      }];
    })),
  };
}
