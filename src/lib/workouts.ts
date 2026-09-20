import { AwaitingReport } from "@/lib/awaiting-report";
import { mirror } from "@shared/workouts";
import type { WorkoutsPayload } from "@/lib/types";

export async function getWorkoutsSnapshot(): Promise<WorkoutsPayload> {
  const stored = await mirror.get();
  if (!stored) throw new AwaitingReport("Awaiting workout report");
  return stored;
}
