import { object } from "@/lib/json";
import type { Workout, WorkoutsPayload } from "@/lib/types";
import { recordStateChange } from "@api/stores/state-journal";
import { mirror, WORKOUT_LIMIT } from "@shared/workouts";

function amount(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`workouts.${field} must be a finite non-negative number`);
  }
  return value;
}

export function normalizeWorkouts(input: unknown, receivedAt = Date.now()): WorkoutsPayload {
  const row = object(input);
  if (!row || !Array.isArray(row.items) || row.items.length > WORKOUT_LIMIT) {
    throw new Error(`workouts.items must contain at most ${WORKOUT_LIMIT} workouts`);
  }
  const ids = new Set<string>();
  const items = row.items.map((input): Workout => {
    const item = object(input);
    if (!item || typeof item.id !== "string" || !/^[0-9a-f-]{36}$/i.test(item.id) ||
      typeof item.activityType !== "string" || !/^[A-Za-z][A-Za-z -]{0,63}$/.test(item.activityType)) {
      throw new Error("Invalid workout identity or activityType");
    }
    const id = item.id.toLowerCase();
    if (ids.has(id)) throw new Error("Duplicate workout id");
    ids.add(id);
    const startedAt = amount(item.startedAt, "startedAt");
    const endedAt = amount(item.endedAt, "endedAt");
    const durationSeconds = amount(item.durationSeconds, "durationSeconds");
    if (startedAt < 1 || endedAt < startedAt || endedAt > receivedAt + 300_000 ||
      durationSeconds > (endedAt - startedAt) / 1000 + 1) throw new Error("Invalid workout interval");
    const secondsFromGMT = item.secondsFromGMT;
    if (typeof secondsFromGMT !== "number" || !Number.isInteger(secondsFromGMT) || Math.abs(secondsFromGMT) > 64800) {
      throw new Error("Invalid workout secondsFromGMT");
    }
    const averageHeartRateBpm = item.averageHeartRateBpm == null ? null : amount(item.averageHeartRateBpm, "averageHeartRateBpm");
    const maximumHeartRateBpm = item.maximumHeartRateBpm == null ? null : amount(item.maximumHeartRateBpm, "maximumHeartRateBpm");
    if ((averageHeartRateBpm != null && averageHeartRateBpm <= 0) ||
      (maximumHeartRateBpm != null && maximumHeartRateBpm <= 0) ||
      (averageHeartRateBpm != null && maximumHeartRateBpm != null && maximumHeartRateBpm < averageHeartRateBpm)) {
      throw new Error("Invalid workout heart rate summary");
    }
    if (item.indoor != null && typeof item.indoor !== "boolean") throw new Error("Invalid workout indoor flag");
    return {
      averageHeartRateBpm, maximumHeartRateBpm,
      elevationAscendedMeters: item.elevationAscendedMeters == null ? null : amount(item.elevationAscendedMeters, "elevationAscendedMeters"),
      indoor: item.indoor ?? null,
      id, activityType: item.activityType, startedAt, endedAt, secondsFromGMT, durationSeconds,
      distanceMeters: item.distanceMeters == null ? null : amount(item.distanceMeters, "distanceMeters"),
      activeEnergyKcal: item.activeEnergyKcal == null ? null : amount(item.activeEnergyKcal, "activeEnergyKcal"),
    };
  }).sort((a, b) => b.endedAt - a.endedAt || a.id.localeCompare(b.id));
  return { items, pushedAt: receivedAt };
}

export async function writeWorkouts(value: WorkoutsPayload): Promise<void> {
  // Full replacement also removes workouts deleted in HealthKit.
  await mirror.put(value);
  await recordStateChange("workouts", value.pushedAt, value.items);
}
