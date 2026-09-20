import { localDate } from "@/lib/freshness";
import type { PulseSample } from "@/lib/types";
import type { StoredActivity } from "@shared/activity";

/** HealthKit 是累计快照；仅估算相邻有效上报之间的平均强度，不外推到此刻。 */
export function activityPulseSample(previous: StoredActivity | null, next: StoredActivity): PulseSample | null {
  if (!previous) return null;
  const before = previous.activity;
  const after = next.activity;
  const elapsed = next.receivedAt - previous.receivedAt;
  // 太短容易被整数取整放大；太长无法定位活动。跨日、换时区、旧日期均重新建立基线。
  if (elapsed < 60_000 || elapsed > 2 * 3_600_000 ||
      before.date !== after.date || before.secondsFromGMT !== after.secondsFromGMT ||
      localDate(previous.receivedAt, before.secondsFromGMT) !== before.date ||
      localDate(next.receivedAt, after.secondsFromGMT) !== after.date) return null;

  const move = after.moveKcal - before.moveKcal;
  const exercise = after.exerciseMinutes - before.exerciseMinutes;
  const stand = after.standHours - before.standHours;
  const steps = before.steps != null && after.steps != null ? after.steps - before.steps : null;
  // HealthKit 修订累计值时不把负增量当空闲或运动。
  if (move < 0 || exercise < 0 || stand < 0 || (steps != null && steps < 0)) return null;
  const minutes = elapsed / 60_000;
  const cadence = (steps ?? 0) / minutes;
  const exerciseRatio = exercise / minutes;
  const level = cadence >= 60 || exerciseRatio >= 0.5 ? 3
    : cadence >= 20 || exerciseRatio >= 0.1 ? 2
      : move > 0 || exercise > 0 || stand > 0 || (steps ?? 0) > 0 ? 1 : 0;
  return { t: previous.receivedAt, until: next.receivedAt, level };
}
