import { loadLag, type LagResult } from "@/lib/lag-result";
import type { Workout, WorkoutsPayload } from "@/lib/types";
import { LAG_KEYS } from "@shared/lag";
import { publicWorkout } from "@shared/workouts";

export async function getWorkoutsSnapshot(): Promise<LagResult<WorkoutsPayload>> {
  const stored = await loadLag<{ items: Workout[] }>(LAG_KEYS.workouts, "Awaiting workout report");
  return stored.map(({ items }) => ({ items: items.map(publicWorkout), pushedAt: stored.updatedAt }));
}
