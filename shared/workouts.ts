import type { Workout } from "@/lib/types";

export const WORKOUT_LIMIT = 10;

// 公开的训练只挑这些字段：上报带来的心率等多余字段一律不出去，存量里有的也一样。
export function publicWorkout(item: Workout): Workout {
  const { id, activityType, startedAt, endedAt, secondsFromGMT, durationSeconds, distanceMeters, activeEnergyKcal, elevationAscendedMeters, indoor } = item;
  return { id, activityType, startedAt, endedAt, secondsFromGMT, durationSeconds, distanceMeters, activeEnergyKcal, elevationAscendedMeters, indoor };
}
