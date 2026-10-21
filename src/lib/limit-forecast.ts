import type { LimitHistoryPoint } from "@shared/limit-history";
import type { VibeCodingLimit } from "@shared/types";

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

// 先验强度：把最近几天的速度当成窗口里已经过了这么久。窗口开头几小时读数太少，全信窗口均速会大起大落；
// 过了一两天窗口均速占主导。
const PRIOR_MS = 24 * HOUR_MS;
// 最近速度只看这几天，按天数衰减，越近权重越大。
const RECENT_DAYS = 7;
const RECENT_HALF_LIFE_MS = 3 * DAY_MS;
// 窗口内的近期速度衰减更快：周中突然加速或减速，预测要在一两天内跟上。
const MOMENTUM_HALF_LIFE_MS = DAY_MS;
// 窗口过了这么久才引入窗口内的近期速度，开头几小时读数太少。
const MOMENTUM_MIN_ELAPSED_MS = DAY_MS;
// 没有历史时，窗口开头这么久内不出预测。
const MIN_ELAPSED_MS = 6 * HOUR_MS;
// 读数到 100 才算用完；停在 98 左右的日子是没怎么用，不是被锁。
const RUN_OUT_PERCENT = 100;
const SAME_RESET_SLACK_S = 3_600;

export type UsageInterval = {
  from: number;
  to: number;
  used: number;
  // 区间开头已经用完，这段的用量是被锁住的，不代表想用多少。
  locked: boolean;
  // 区间中途用完，真实需求不少于 used。
  capped: boolean;
};

export type LimitForecast = {
  startAt: number;
  resetAt: number;
  now: number;
  usedPercent: number;
  elapsedFraction: number;
  // 百分点 / 毫秒；null 表示数据不够，不出预测。
  rate: number | null;
  evenRate: number;
  runOutAt: number | null;
  ranOut: boolean;
  lockedMs: number | null;
  percentAtReset: number | null;
  window: Array<[at: number, usedPercent: number]>;
  lastWeek: LastWeek | null;
};

// 上一个窗口的收尾：peakPercent 是最高读数；lockedMs 是从读数到 100 到重置的时长，没用完为 null。
// 超过 LIMIT_HISTORY_HOURLY_DAYS 的历史每天只有一点，lockedMs 只精确到天。
export type LastWeek = { peakPercent: number; lockedMs: number | null };

function sameWindow(left: number | null, right: number | null) {
  return left != null && right != null && Math.abs(left - right) <= SAME_RESET_SLACK_S;
}

export function usageIntervals(points: LimitHistoryPoint[], windowMs: number): UsageInterval[] {
  const sorted = [...points].sort((left, right) => left[0] - right[0]);
  const intervals: UsageInterval[] = [];
  for (let index = 1; index < sorted.length; index++) {
    const [fromAt, fromUsed, fromReset] = sorted[index - 1]!;
    const [toAt, toUsed, toReset] = sorted[index]!;
    if (toAt <= fromAt) continue;
    // 读数掉下来就是中间重置过：重置前那一截没有读数，只能记重置后的部分。
    const reset = !sameWindow(fromReset, toReset) || toUsed < fromUsed - 1;
    if (reset) {
      const windowStart = toReset != null ? toReset * 1000 - windowMs : fromAt;
      const from = Math.min(toAt, Math.max(fromAt, windowStart));
      intervals.push({ from, to: toAt, used: toUsed, locked: false, capped: toUsed >= RUN_OUT_PERCENT });
      continue;
    }
    intervals.push({
      from: fromAt,
      to: toAt,
      used: Math.max(0, toUsed - fromUsed),
      locked: fromUsed >= RUN_OUT_PERCENT,
      capped: toUsed >= RUN_OUT_PERCENT,
    });
  }
  return intervals;
}

// 被锁住或中途用完的区间只说明「至少这么多」，算速度时剔掉，否则用完那几天会把速度压低。
export function recentRate(intervals: UsageInterval[], now: number, halfLifeMs = RECENT_HALF_LIFE_MS): number | null {
  let used = 0;
  let span = 0;
  for (const interval of intervals) {
    if (interval.locked || interval.capped) continue;
    const age = now - interval.to;
    if (age < 0 || age > RECENT_DAYS * DAY_MS) continue;
    const weight = 0.5 ** (age / halfLifeMs);
    used += weight * interval.used;
    span += weight * (interval.to - interval.from);
  }
  return span >= 12 * HOUR_MS ? used / span : null;
}

export function lastWeekOf(history: LimitHistoryPoint[], startAt: number): LastWeek | null {
  const points = history
    .filter(([at, , resetsAt]) => at <= startAt && sameWindow(resetsAt, startAt / 1000))
    .sort((left, right) => left[0] - right[0]);
  if (!points.length) return null;
  const ranOut = points.find(([, used]) => used >= RUN_OUT_PERCENT);
  return {
    peakPercent: Math.max(...points.map(([, used]) => used)),
    lockedMs: ranOut ? startAt - ranOut[0] : null,
  };
}

// readAt 是 limit 这份读数的时刻：KV 里的当前读数可能比 D1 归档晚一拍，比它新的归档点不能拿来比。
export function forecastLimit(
  limit: VibeCodingLimit,
  history: LimitHistoryPoint[],
  readAt: number,
): LimitForecast | null {
  const now = readAt;
  if (limit.windowMinutes == null || limit.resetsAt == null) return null;
  const windowMs = limit.windowMinutes * 60_000;
  const resetAt = limit.resetsAt * 1000;
  const startAt = resetAt - windowMs;
  if (windowMs <= 0 || now >= resetAt || now < startAt) return null;

  const usedPercent = limit.usedPercent;
  const elapsed = now - startAt;
  const evenRate = 100 / windowMs;
  const past = history.filter(([at]) => at < now);
  const intervals = usageIntervals([...past, [now, usedPercent, limit.resetsAt]], windowMs);
  const inWindow = past.filter(([at, , resetsAt]) => at > startAt && sameWindow(resetsAt, limit.resetsAt));
  const window: Array<[number, number]> = [[startAt, 0], ...inWindow.map(([at, used]): [number, number] => [at, used]), [now, usedPercent]];

  const ranOutPoint = window.find(([, used]) => used >= RUN_OUT_PERCENT);
  const base = {
    startAt,
    resetAt,
    now,
    usedPercent,
    elapsedFraction: elapsed / windowMs,
    evenRate,
    window,
    lastWeek: lastWeekOf(past, startAt),
  };
  if (ranOutPoint) {
    return {
      ...base,
      rate: usedPercent / elapsed,
      runOutAt: ranOutPoint[0],
      ranOut: true,
      lockedMs: resetAt - ranOutPoint[0],
      percentAtReset: 100,
    };
  }

  const prior = recentRate(intervals.filter((interval) => interval.to <= startAt + 1), now);
  let rate: number | null;
  if (prior != null) rate = (usedPercent + prior * PRIOR_MS) / (elapsed + PRIOR_MS);
  else rate = elapsed >= MIN_ELAPSED_MS ? usedPercent / elapsed : null;
  const momentum = elapsed >= MOMENTUM_MIN_ELAPSED_MS
    ? recentRate(intervals.filter((interval) => interval.to > startAt), now, MOMENTUM_HALF_LIFE_MS)
    : null;
  if (rate != null && momentum != null) rate = (rate + momentum) / 2;

  if (rate == null) {
    return { ...base, rate: null, runOutAt: null, ranOut: false, lockedMs: null, percentAtReset: null };
  }
  const runOutAt = rate > 0 ? now + (RUN_OUT_PERCENT - usedPercent) / rate : null;
  const runsOut = runOutAt != null && runOutAt < resetAt;
  return {
    ...base,
    rate,
    runOutAt: runsOut ? runOutAt : null,
    ranOut: false,
    lockedMs: runsOut ? resetAt - runOutAt : null,
    percentAtReset: runsOut ? 100 : Math.min(100, usedPercent + rate * (resetAt - now)),
  };
}

export type ForecastSample = {
  at: number;
  phase: "used" | "projected" | "locked";
  // used：实际读数插值；projected：按预测速度外推；locked 与没出预测时为 null。
  percent: number | null;
  // 从现在起匀速用到重置正好 100% 的那条线，只在现在及之后、还没用完时有值。
  target: number | null;
  even: number;
};

export function sampleForecast(forecast: LimitForecast, at: number): ForecastSample {
  const even = (100 * (at - forecast.startAt)) / (forecast.resetAt - forecast.startAt);
  const target = at >= forecast.now && forecast.usedPercent < 100
    ? forecast.usedPercent + ((100 - forecast.usedPercent) * (at - forecast.now)) / (forecast.resetAt - forecast.now)
    : null;
  if (forecast.runOutAt != null && at >= forecast.runOutAt) return { at, phase: "locked", percent: null, target, even };
  if (at <= forecast.now) {
    const window = forecast.window;
    const after = window.findIndex(([pointAt]) => pointAt >= at);
    const [toAt, toUsed] = window[Math.max(0, after)] ?? window.at(-1)!;
    const [fromAt, fromUsed] = window[Math.max(0, after - 1)]!;
    const percent = toAt > fromAt ? fromUsed + ((toUsed - fromUsed) * (at - fromAt)) / (toAt - fromAt) : toUsed;
    return { at, phase: "used", percent, target, even };
  }
  const percent = forecast.rate == null ? null : Math.min(100, forecast.usedPercent + forecast.rate * (at - forecast.now));
  return { at, phase: "projected", percent, target, even };
}
