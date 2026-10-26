import type { Job } from "./job";

export function epochMinute(time: number): number {
  return Math.floor(time / 60_000);
}

type Cadence = Pick<Job, "everyMinutes" | "offset">;

export function slotStart(job: Cadence, time: number): number {
  const minute = epochMinute(time);
  return minute - (((minute - job.offset) % job.everyMinutes) + job.everyMinutes) % job.everyMinutes;
}

export function isDue(job: Cadence, time: number): boolean {
  return slotStart(job, time) === epochMinute(time);
}

// 每个任务的已认领格只进不退：同一格或更早的格（同格补到的第二轮、带旧时刻重投的一轮）认领失败。
export function claimSlots(stored: ReadonlyMap<string, number>, wanted: Readonly<Record<string, number>>): string[] {
  return Object.entries(wanted).filter(([name, slot]) => (stored.get(name) ?? -Infinity) < slot).map(([name]) => name);
}
