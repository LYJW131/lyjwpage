import { PULSE_SILENT_AFTER_MS } from "@/lib/limits";
import type { PulseLevel, PulseSample } from "@/lib/types";

/**
 * 实测域送去 Jev 之前的共用预处理。
 *
 * Jev 文档（model-jaggedness）说得很直白：它不会数数、不会算时长、不会比时间戳，
 * 把原始 `{from, to, level}` 扔过去等于让它做它做不了的事。所以这里把阶跃序列裁成
 * 窗口内的连续段，再由各域按自己的语义算出**命名的秒数和次数**——模型只拿到
 * `playingSeconds` 这种它读得懂的字段，算术全在代码里。与 shared/pulse-coding 的
 * `codingWindowFeatures` 同一套路，那条是先做对的那条。
 */

export type MeasuredRun = { from: number; to: number; level: PulseLevel; hint?: string; powerW?: number };
export type Coverage = { from: number; to: number };
export type MeasuredWindow = {
  runs: MeasuredRun[];
  /** 有序、不重叠、裁进窗口；评估存的就是它 */
  coverage: Coverage[];
  observedSeconds: number;
  unknownSeconds: number;
};

/** Jev 一问的形状。id 不发给模型，所以完整语义都写在 instructions / criteria 里。 */
export type ScoreQuestion = { type: "score"; instructions: string; criteria: string[] };
export type ChoiceQuestion = { type: "choice"; instructions: string; criteria: Record<string, string> };
export type PulseQuestion = ScoreQuestion | ChoiceQuestion;

/** 一笔样本撑到什么时候。同 pulse-window 的 heldUntil；评分器已把 until 按各域的有效期填好。 */
function heldUntil(sample: PulseSample, nextAt: number): number {
  if (sample.until != null) return Math.min(sample.until, nextAt);
  if (sample.level === 0) return nextAt;
  return Math.min(nextAt, sample.t + PULSE_SILENT_AFTER_MS);
}

export function seconds(ms: number): number {
  return Math.round(ms / 1000);
}

/** 占已观测时间的整数百分比。比例在这里除好，判据里写"under 25"这种模型读得懂的话。 */
export function percent(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

/** 裁窗、并段。相邻同档同 hint 同功率才并；静默留下的断口不并，那就是 unknown。 */
export function measuredWindow(samples: PulseSample[], window: Coverage): MeasuredWindow {
  const runs: MeasuredRun[] = [];
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    const nextAt = index + 1 < samples.length ? samples[index + 1].t : window.to;
    const from = Math.max(sample.t, window.from);
    const to = Math.min(heldUntil(sample, nextAt), window.to);
    if (to <= from) continue;
    const previous = runs[runs.length - 1];
    if (previous && previous.to === from && previous.level === sample.level && previous.hint === sample.hint && previous.powerW === sample.powerW) {
      previous.to = to;
    } else {
      runs.push({ from, to, level: sample.level, ...(sample.hint ? { hint: sample.hint } : {}), ...(sample.powerW != null ? { powerW: sample.powerW } : {}) });
    }
  }
  const coverage: Coverage[] = [];
  for (const run of runs) {
    const last = coverage[coverage.length - 1];
    if (last && last.to === run.from) last.to = run.to;
    else coverage.push({ from: run.from, to: run.to });
  }
  const observedMs = coverage.reduce((sum, part) => sum + part.to - part.from, 0);
  return { runs, coverage, observedSeconds: seconds(observedMs), unknownSeconds: seconds(window.to - window.from - observedMs) };
}

/**
 * 覆盖区间必须有序且不重叠 —— parsePulseAssessment 校不过就会把整条评估悄悄丢掉。
 * 来源不止一处时（listening 的实测段加上「最近在听」痕迹）先并成一串再存。
 */
export function mergeCoverage(parts: Coverage[]): Coverage[] {
  const merged: Coverage[] = [];
  for (const part of parts.filter((p) => p.to > p.from).sort((a, b) => a.from - b.from)) {
    const last = merged[merged.length - 1];
    if (last && part.from <= last.to) last.to = Math.max(last.to, part.to);
    else merged.push({ from: part.from, to: part.to });
  }
  return merged;
}

export function secondsWhere(runs: MeasuredRun[], test: (run: MeasuredRun) => boolean): number {
  return seconds(runs.filter(test).reduce((sum, run) => sum + run.to - run.from, 0));
}

/** 最长的一段连续满足条件的时间：相邻（首尾相接）的段累加，断口或不满足就从头算。 */
export function longestRunSeconds(runs: MeasuredRun[], test: (run: MeasuredRun) => boolean): number {
  let longest = 0, current = 0, previousTo: number | null = null;
  for (const run of runs) {
    if (!test(run)) { current = 0; previousTo = run.to; continue; }
    current = previousTo === run.from ? current + run.to - run.from : run.to - run.from;
    longest = Math.max(longest, current);
    previousTo = run.to;
  }
  return seconds(longest);
}

/**
 * 连续段之间 hint 换了几次。只数两侧都满足条件、且首尾相接的边界——中间隔着
 * 静默的不算，那是两次独立的观测，不是一次切换。
 */
export function changesWhere(runs: MeasuredRun[], test: (run: MeasuredRun) => boolean): number {
  let changes = 0;
  for (let index = 1; index < runs.length; index += 1) {
    const previous = runs[index - 1], run = runs[index];
    if (previous.to === run.from && test(previous) && test(run) && previous.hint !== run.hint) changes += 1;
  }
  return changes;
}

/** 满足条件的段按 hint 汇总时长，长的在前，最多 limit 条。 */
export function topHints(runs: MeasuredRun[], test: (run: MeasuredRun) => boolean, limit = 8): { title: string; seconds: number }[] {
  const totals = new Map<string, number>();
  for (const run of runs) {
    if (!test(run) || !run.hint) continue;
    totals.set(run.hint, (totals.get(run.hint) ?? 0) + run.to - run.from);
  }
  return [...totals].map(([title, ms]) => ({ title, seconds: seconds(ms) })).sort((a, b) => b.seconds - a.seconds).slice(0, limit);
}
