import type { Workout } from "@/lib/types";

export function workoutDuration(seconds: number): string {
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor(whole / 60) % 60;
  const remainder = String(whole % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${remainder}` : `${minutes}:${remainder}`;
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
