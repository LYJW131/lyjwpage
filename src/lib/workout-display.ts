import { formatClock } from "@/lib/clock-format";
import type { Workout } from "@/lib/types";

export function workoutDuration(seconds: number): string {
  const whole = Math.floor(seconds);
  return formatClock(whole > 0 ? whole * 1000 : 0);
}

export function workoutMetrics(workout: Workout): { label: string; value: string }[] {
  const result = [{ label: "Duration", value: workoutDuration(workout.durationSeconds) }];
  const distance = workout.distanceMeters;
  if (distance != null) {
    result.push({ label: "Distance", value: `${(distance / 1000).toLocaleString("en-US", { maximumFractionDigits: 2 })} km` });
  } else if (workout.activeEnergyKcal != null) {
    result.push({ label: "Active energy", value: `${Math.floor(workout.activeEnergyKcal).toLocaleString("en-US")} kcal` });
  }
  return result;
}
