import type { Job } from "./job";


export function epochMinute(time: number): number {
  return Math.floor(time / 60_000);
}

export function isDue(job: Pick<Job, "everyMinutes" | "offset">, time: number): boolean {
  return epochMinute(time) % job.everyMinutes === job.offset;
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

const MIN_CHECKIN_MINUTES = 5;

// 报到周期必须与任务周期相交，否则任务不运行的分钟会被 Sentry 判作漏报。
export function checkinEveryMinutes(job: Pick<Job, "everyMinutes">): number {
  const every = job.everyMinutes;
  return every >= MIN_CHECKIN_MINUTES ? every : (every * MIN_CHECKIN_MINUTES) / gcd(every, MIN_CHECKIN_MINUTES);
}

export function checkinDue(job: Pick<Job, "everyMinutes" | "offset">, time: number): boolean {
  return epochMinute(time) % checkinEveryMinutes(job) === job.offset;
}

export function checkinCrontab(job: Pick<Job, "everyMinutes" | "offset">): string {
  const every = checkinEveryMinutes(job);
  if (every >= 60) return `${job.offset} * * * *`;
  return job.offset ? `${job.offset}-59/${every} * * * *` : `*/${every} * * * *`;
}

export function monitorSlug(job: Pick<Job, "name">): string {
  return `collector-${job.name}`;
}

export function monitorConfig(job: Pick<Job, "everyMinutes" | "offset" | "maxRuntimeMinutes">) {
  const every = checkinEveryMinutes(job);
  return {
    schedule: { type: "crontab", value: checkinCrontab(job) },
    checkinMargin: Math.min(5, Math.max(2, Math.floor(every / 5))),
    maxRuntime: job.maxRuntimeMinutes,
    timezone: "UTC",
    failureIssueThreshold: 2,
    recoveryThreshold: 1,
  } as const;
}
