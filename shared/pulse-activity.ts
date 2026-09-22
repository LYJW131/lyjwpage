import { localDate } from "@/lib/freshness";
import type { PulseSample } from "@/lib/types";
import type { StoredActivity } from "@shared/activity";
import { longestRunSeconds, measuredWindow, mergeCoverage, percent, secondsWhere, type Coverage, type ScoreQuestion } from "@shared/pulse-features";

/** 一条已完成的 HealthKit 训练。时间是 epoch 毫秒；秒数是扣除暂停后的活动时长。 */
export type ActivityWorkout = {
  activityType: string;
  startedAt: number;
  endedAt: number;
  durationSeconds: number;
};

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
  /**
   * 已完成训练落在这个窗口里的活动秒数，按整段 `durationSeconds` 占
   * `startedAt`–`endedAt` 的比例摊到窗口上。圆环桶不算这笔。
   */
  workoutSeconds: number;
  /** workoutSeconds 占 observedSeconds 的整数百分比 */
  workoutPercent: number;
  /** 上报的项目名原样，例如 Fencing；seconds 已按窗口算好 */
  workouts: { activityType: string; seconds: number }[];
};

/** 脏行丢掉。评分只认项目名、起止和活动时长，其余指标不进 Jev。 */
export function parseActivityWorkouts(raw: string | null): ActivityWorkout[] {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    const items = value && typeof value === "object" && !Array.isArray(value)
      ? (value as { items?: unknown }).items
      : undefined;
    if (!Array.isArray(items)) return [];
    const workouts: ActivityWorkout[] = [];
    for (const item of items) {
      if (!item || typeof item !== "object" || Array.isArray(item)) continue;
      const row = item as { activityType?: unknown; startedAt?: unknown; endedAt?: unknown; durationSeconds?: unknown };
      const activityType = typeof row.activityType === "string" ? row.activityType.trim() : "";
      if (!activityType || activityType.length > 64) continue;
      if (typeof row.startedAt !== "number" || typeof row.endedAt !== "number" || typeof row.durationSeconds !== "number") continue;
      if (!Number.isFinite(row.startedAt) || !Number.isFinite(row.endedAt) || !Number.isFinite(row.durationSeconds)) continue;
      if (row.endedAt <= row.startedAt || row.durationSeconds < 0) continue;
      workouts.push({
        activityType,
        startedAt: row.startedAt,
        endedAt: row.endedAt,
        durationSeconds: row.durationSeconds,
      });
    }
    return workouts;
  } catch {
    return [];
  }
}

function clipWorkout(workout: ActivityWorkout, window: Coverage): { from: number; to: number; seconds: number } | null {
  const from = Math.max(window.from, workout.startedAt);
  const to = Math.min(window.to, workout.endedAt);
  const wall = workout.endedAt - workout.startedAt;
  if (!(to > from) || !(wall > 0)) return null;
  const activeMs = Math.min(to - from, workout.durationSeconds * 1000 * ((to - from) / wall));
  const seconds = Math.round(activeMs / 1000);
  return seconds > 0 ? { from, to, seconds } : null;
}

export function activityWindowFeatures(
  samples: PulseSample[],
  window: Coverage,
  workouts: readonly ActivityWorkout[] = [],
): { features: ActivityWindowFeatures; coverage: Coverage[] } {
  const measured = measuredWindow(samples, window);
  const clips = workouts
    .map((workout) => ({ workout, clip: clipWorkout(workout, window) }))
    .filter((row): row is { workout: ActivityWorkout; clip: { from: number; to: number; seconds: number } } => row.clip != null)
    .sort((a, b) => a.workout.startedAt - b.workout.startedAt || a.workout.activityType.localeCompare(b.workout.activityType));
  const coverage = mergeCoverage([...measured.coverage, ...clips.map((row) => ({ from: row.clip.from, to: row.clip.to }))]);
  const observedMs = coverage.reduce((sum, part) => sum + part.to - part.from, 0);
  const observedSeconds = Math.round(observedMs / 1000);
  const byType = new Map<string, number>();
  for (const { workout, clip } of clips) byType.set(workout.activityType, (byType.get(workout.activityType) ?? 0) + clip.seconds);
  const named = [...byType.entries()].map(([activityType, seconds]) => ({ activityType, seconds }));
  const workoutSeconds = Math.min(observedSeconds, named.reduce((sum, item) => sum + item.seconds, 0));
  const moderateSeconds = secondsWhere(measured.runs, (run) => run.level === 2);
  const vigorousSeconds = secondsWhere(measured.runs, (run) => run.level === 3);
  const longestMovingRunSeconds = longestRunSeconds(measured.runs, (run) => run.level >= 2);
  return {
    coverage,
    features: {
      observedSeconds,
      unknownSeconds: Math.round((window.to - window.from - observedMs) / 1000),
      stillSeconds: secondsWhere(measured.runs, (run) => run.level === 0),
      lightSeconds: secondsWhere(measured.runs, (run) => run.level === 1),
      moderateSeconds,
      vigorousSeconds,
      longestMovingRunSeconds,
      movingPercent: percent(moderateSeconds + vigorousSeconds, observedSeconds),
      vigorousPercent: percent(vigorousSeconds, observedSeconds),
      longestMovingRunPercent: percent(longestMovingRunSeconds, observedSeconds),
      workoutSeconds,
      workoutPercent: percent(workoutSeconds, observedSeconds),
      workouts: named,
    },
  };
}

export const ACTIVITY_INTENSITY = [
  "No movement: `stillSeconds` is the whole observed time, `movingPercent` is 0, and `workoutPercent` is 0.",
  "Light movement only, such as standing or a few steps: `lightSeconds` present, `movingPercent` is 0, and `workoutPercent` is 0.",
  "Moderate movement (at least 20 steps per minute or 10% of minutes counted as exercise) for part of the observed time and no reported workout: `movingPercent` under 50 and `workoutPercent` is 0. Or a reported workout covers only a short slice: `workoutPercent` under 25 while `vigorousPercent` is under 50.",
  "Moderate movement for most of the observed time (`movingPercent` 50 or above), or vigorous movement (at least 60 steps per minute or half the minutes counted as exercise) for part of it (`vigorousPercent` under 50), while `workoutPercent` is under 50. Or a reported workout covers a substantial part but not most of the observed time: `workoutPercent` at least 25 and under 50.",
  "Vigorous movement for most of the observed time (`vigorousPercent` 50 or above), or a reported workout covers most of the observed time (`workoutPercent` 50 or above). The sport is the `activityType` on `workouts`.",
];
export const ACTIVITY_CONTINUITY = [
  "No moderate or vigorous movement and no reported workout: `movingPercent` is 0 and `workoutPercent` is 0.",
  "Moderate or vigorous movement, or a reported workout, in one short burst or scattered fragments: `longestMovingRunPercent` under 25 and `workoutPercent` under 25.",
  "Moderate or vigorous movement, or a reported workout, for a substantial part of the observed time but not almost all of it: `longestMovingRunPercent` or `workoutPercent` is at least 25 and under 75.",
  "One sustained stretch covering almost all observed time: `longestMovingRunPercent` 75 or above, or one reported workout covers almost all of it (`workoutPercent` 75 or above).",
];

export function activityQuestions(): { intensity: ScoreQuestion; continuity: ScoreQuestion } {
  const context = "The state describes one five-minute window. `stillSeconds`, `lightSeconds`, `moderateSeconds` and `vigorousSeconds` are estimated from Apple Watch activity-ring totals between reports, as seconds and integer percents of `observedSeconds`. `workouts` are completed HealthKit sessions overlapping this window: each `activityType` is the reported sport name, such as Fencing, and `seconds` is that session's active duration inside the window. `workoutSeconds` is their sum and `workoutPercent` is that sum as an integer percent of `observedSeconds`. A named workout is intentional exercise even when the ring buckets are low, because cumulative reports can miss the session. `unknownSeconds` is time with neither a ring report nor a workout: it is unknown, not still.";
  return {
    intensity: { type: "score", instructions: `${context} How much physical activity happened in the observed time?`, criteria: ACTIVITY_INTENSITY },
    continuity: { type: "score", instructions: `${context} How continuous was the movement in the observed time?`, criteria: ACTIVITY_CONTINUITY },
  };
}
