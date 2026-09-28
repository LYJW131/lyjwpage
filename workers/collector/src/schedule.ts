import type { Job } from "./job";

/**
 * 节奏与 Sentry 监控的纯计算，不碰网络，单测覆盖。
 *
 * 「第几分钟」一律按 epoch 起算的整分钟数：周期都整除 60，所以和 UTC 时钟上的
 * 分钟对得上，Sentry 那边按 crontab 排期也就对得上。
 */

export function epochMinute(time: number): number {
  return Math.floor(time / 60_000);
}

export function isDue(job: Pick<Job, "everyMinutes" | "offset">, time: number): boolean {
  return epochMinute(time) % job.everyMinutes === job.offset;
}

function gcd(a: number, b: number): number {
  return b ? gcd(b, a % b) : a;
}

/** 最短每 5 分钟报到一次：每次报到是开始、结束两个请求，分钟级的任务每一轮都报太费 */
const MIN_CHECKIN_MINUTES = 5;

/**
 * 多少分钟报到一次。周期不短于 5 分钟的每轮都报；更短的挑「既是这个任务的一轮、
 * 又是 5 的倍数」那几轮 —— 2 分钟一轮的任务就是每 10 分钟报一次，否则奇数个 5 分钟
 * 那一格它根本不跑，Sentry 会记成漏报。
 */
export function checkinEveryMinutes(job: Pick<Job, "everyMinutes">): number {
  const every = job.everyMinutes;
  return every >= MIN_CHECKIN_MINUTES ? every : (every * MIN_CHECKIN_MINUTES) / gcd(every, MIN_CHECKIN_MINUTES);
}

/** 这一轮要不要给 Sentry 报到；只在任务本来就该跑的那一轮上判断 */
export function checkinDue(job: Pick<Job, "everyMinutes" | "offset">, time: number): boolean {
  return epochMinute(time) % checkinEveryMinutes(job) === job.offset;
}

/** 报到节奏写成 crontab：`*\/5`、`3-59/15`、每小时第 7 分钟是 `7 * * * *` */
export function checkinCrontab(job: Pick<Job, "everyMinutes" | "offset">): string {
  const every = checkinEveryMinutes(job);
  if (every >= 60) return `${job.offset} * * * *`;
  return job.offset ? `${job.offset}-59/${every} * * * *` : `*/${every} * * * *`;
}

export function monitorSlug(job: Pick<Job, "name">): string {
  return `collector-${job.name}`;
}

/**
 * 随每次报到同步到 Sentry 的监控设置：改这里就改了那边。连续两次没按时报到或报错
 * 才开 issue，一次恢复就关，单次上游抖动不吵人。
 */
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
