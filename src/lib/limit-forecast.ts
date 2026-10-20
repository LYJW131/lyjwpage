import { siteDay } from "@shared/history-ingest";
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
// 没有历史时，窗口开头这么久内不出预测。
const MIN_ELAPSED_MS = 6 * HOUR_MS;
// 到这条线就算用完：实测用完后读数会停在 98 好几天，不一定走到 100。
const RUN_OUT_PERCENT = 98;
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
  days: Array<{ date: string; used: number; locked: boolean; partial: boolean }>;
};

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
export function recentRate(intervals: UsageInterval[], now: number): number | null {
  let used = 0;
  let span = 0;
  for (const interval of intervals) {
    if (interval.locked || interval.capped) continue;
    const age = now - interval.to;
    if (age < 0 || age > RECENT_DAYS * DAY_MS) continue;
    const weight = 0.5 ** (age / RECENT_HALF_LIFE_MS);
    used += weight * interval.used;
    span += weight * (interval.to - interval.from);
  }
  return span >= 12 * HOUR_MS ? used / span : null;
}

function dailyUsage(intervals: UsageInterval[], now: number, timeZoneDay: (at: number) => string) {
  const days = new Map<string, { used: number; locked: boolean }>();
  for (const interval of intervals) {
    const date = timeZoneDay(interval.to - 1);
    const day = days.get(date) ?? { used: 0, locked: false };
    day.used += interval.used;
    day.locked ||= interval.locked || interval.capped;
    days.set(date, day);
  }
  const today = timeZoneDay(now);
  return [...days.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(-RECENT_DAYS)
    .map(([date, day]) => ({ date, used: day.used, locked: day.locked, partial: date === today }));
}

// readAt 是 limit 这份读数的时刻：KV 里的当前读数可能比 D1 归档晚一拍，比它新的归档点不能拿来比。
export function forecastLimit(
  limit: VibeCodingLimit,
  history: LimitHistoryPoint[],
  readAt: number,
  timeZoneDay: (at: number) => string = siteDay,
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
    days: dailyUsage(intervals, now, timeZoneDay),
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
