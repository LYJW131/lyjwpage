import type { WorkoutsPayload } from "@shared/types";
import { writePulseWorkouts } from "@core/stores/pulse";

export async function writeWorkouts(value: WorkoutsPayload): Promise<void> {
  await writePulseWorkouts(value.items.map(({ startedAt, endedAt, activityType }) => ({ startedAt, endedAt, activityType })));
}
