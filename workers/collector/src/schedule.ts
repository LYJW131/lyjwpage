import type { Job } from "./job";

export function epochMinute(time: number): number {
  return Math.floor(time / 60_000);
}

export function isDue(job: Pick<Job, "everyMinutes" | "offset">, time: number): boolean {
  return epochMinute(time) % job.everyMinutes === job.offset;
}
