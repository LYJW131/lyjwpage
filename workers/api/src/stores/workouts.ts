import type { WorkoutsPayload } from "@/lib/types";
import { writePulseWorkouts } from "@api/stores/pulse";

export async function writeWorkouts(value: WorkoutsPayload): Promise<void> {
  await writePulseWorkouts(value.items.map(({ startedAt, endedAt, activityType }) => ({ startedAt, endedAt, activityType })));
}
