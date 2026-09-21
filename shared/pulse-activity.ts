import { localDate } from "@/lib/freshness";
import type { PulseSample } from "@/lib/types";
import type { StoredActivity } from "@shared/activity";
import { longestRunSeconds, measuredWindow, percent, secondsWhere, type Coverage, type ScoreQuestion } from "@shared/pulse-features";

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

/**
 * 身体活动的五分钟事实。档位在上面 activityPulseSample 里由步频和锻炼分钟占比算出，
 * 样本只存档位，所以这里能给模型的是四个**命名**的秒数桶，每个桶在判据里写清楚
 * 它对应的步频 / 锻炼占比——不再让模型拿着 0–3 去查图例。
 */
export type ActivityWindowFeatures = {
  observedSeconds: number;
  unknownSeconds: number;
  stillSeconds: number;
  lightSeconds: number;
  moderateSeconds: number;
  vigorousSeconds: number;
  longestMovingRunSeconds: number;
  /** moderate + vigorous 占 observedSeconds 的整数百分比 */
  movingPercent: number;
  vigorousPercent: number;
  longestMovingRunPercent: number;
};

export function activityWindowFeatures(samples: PulseSample[], window: Coverage): { features: ActivityWindowFeatures; coverage: Coverage[] } {
  const measured = measuredWindow(samples, window);
  const moderateSeconds = secondsWhere(measured.runs, (run) => run.level === 2);
  const vigorousSeconds = secondsWhere(measured.runs, (run) => run.level === 3);
  const longestMovingRunSeconds = longestRunSeconds(measured.runs, (run) => run.level >= 2);
  return {
    coverage: measured.coverage,
    features: {
      observedSeconds: measured.observedSeconds,
      unknownSeconds: measured.unknownSeconds,
      stillSeconds: secondsWhere(measured.runs, (run) => run.level === 0),
      lightSeconds: secondsWhere(measured.runs, (run) => run.level === 1),
      moderateSeconds,
      vigorousSeconds,
      longestMovingRunSeconds,
      movingPercent: percent(moderateSeconds + vigorousSeconds, measured.observedSeconds),
      vigorousPercent: percent(vigorousSeconds, measured.observedSeconds),
      longestMovingRunPercent: percent(longestMovingRunSeconds, measured.observedSeconds),
    },
  };
}

export const ACTIVITY_INTENSITY = [
  "No movement: `stillSeconds` is the whole observed time and `movingPercent` is 0.",
  "Light movement only, such as standing or a few steps: `lightSeconds` present but `movingPercent` is 0.",
  "Moderate movement (at least 20 steps per minute or 10% of minutes counted as exercise) for part of the observed time: `movingPercent` under 50.",
  "Moderate movement for most of the observed time (`movingPercent` 50 or above), or vigorous movement (at least 60 steps per minute or half the minutes counted as exercise) for part of it (`vigorousPercent` under 50).",
  "Vigorous movement for most of the observed time: `vigorousPercent` 50 or above.",
];
export const ACTIVITY_CONTINUITY = [
  "No moderate or vigorous movement: `movingPercent` is 0.",
  "Moderate or vigorous movement in one short burst or scattered fragments: `longestMovingRunPercent` under 25.",
  "Moderate or vigorous movement for a substantial part of the observed time but with meaningful still or light interruptions: `longestMovingRunPercent` between 25 and 75.",
  "One sustained stretch of moderate or vigorous movement covering almost all observed time: `longestMovingRunPercent` 75 or above.",
];

export function activityQuestions(): { intensity: ScoreQuestion; continuity: ScoreQuestion } {
  const context = "The state describes one five-minute window of physical activity estimated from Apple Watch cumulative reports (averaged between reports, not live workout detection), as precomputed seconds and integer percents of `observedSeconds` per movement level. `unknownSeconds` is time with no report: it is unknown, not still.";
  return {
    intensity: { type: "score", instructions: `${context} How much physical activity happened in the observed time?`, criteria: ACTIVITY_INTENSITY },
    continuity: { type: "score", instructions: `${context} How continuous was the movement in the observed time?`, criteria: ACTIVITY_CONTINUITY },
  };
}
