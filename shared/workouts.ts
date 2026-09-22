import { key, mirrorKey } from "@/lib/storage";
import type { WorkoutsPayload } from "@/lib/types";

export const WORKOUT_LIMIT = 10;
export const workoutsKey = () => key("workouts", "recent");
export const mirror = mirrorKey<WorkoutsPayload>(["workouts", "recent"], (value) => value.pushedAt);
