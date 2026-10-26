import { setTimeout as sleep } from "node:timers/promises";

import { RETIRED_COLLECTOR_JOBS, type CollectorJobOutcome } from "@shared/collector";
import { withRequestState } from "@shared/request-state";

import type { Env } from "./env";
import { explain, type Job } from "./job";
import { appleRecentJob } from "./jobs/apple-recent";
import { avatarWatchJob } from "./jobs/avatar-watch";
import { cloudflareDeploymentsJob, cloudflareMetricsJob } from "./jobs/cloudflare";
import { digestJob } from "./jobs/digest";
import { githubChartJob } from "./jobs/github-chart";
import { githubRepoJob } from "./jobs/github-repo";
import { pagespeedJob } from "./jobs/pagespeed";
import { providerStatusJob } from "./jobs/provider-status";
import { siteHealthJob } from "./jobs/site-health";
import { siteAnalyticsJob, siteDeploymentsJob } from "./jobs/site-status";
import { uptimeProbeJob } from "./jobs/uptime-probe";
import { isDue, slotStart } from "./schedule";

export const JOBS: readonly Job[] = [
  appleRecentJob,
  providerStatusJob,
  pagespeedJob,
  githubChartJob,
  githubRepoJob,
  siteDeploymentsJob,
  siteAnalyticsJob,
  cloudflareDeploymentsJob,
  cloudflareMetricsJob,
  uptimeProbeJob,
  siteHealthJob,
  digestJob,
  avatarWatchJob,
];

export function findJob(name: string, jobs: readonly Job[] = JOBS): Job | undefined {
  return jobs.find((job) => job.name === name);
}

export function dueJobs(time: number, jobs: readonly Job[] = JOBS): Job[] {
  return jobs.filter((job) => isDue(job, time));
}

export async function runJob(job: Job, env: Env, options: { now?: number; scheduled?: boolean } = {}): Promise<CollectorJobOutcome> {
  const started = Date.now();
  const now = options.now ?? started;
  try {
    const result = await withRequestState(() => job.run({ env, now, scheduled: options.scheduled ?? false }));
    return outcome(job, result.status, result.detail, started);
  } catch (error) {
    const failed = outcome(job, "error", explain(error), started);
    const outage = (error as { outage?: unknown } | null)?.outage === true;
    (outage ? console.warn : console.error)(JSON.stringify({ event: "collector-job", ...failed }));
    return failed;
  }
}

function outcome(job: Job, status: CollectorJobOutcome["status"], detail: string | undefined, started: number): CollectorJobOutcome {
  return { job: job.name, status, ...(detail ? { detail } : {}), ms: Date.now() - started };
}

export const HEAD_START_MS = 3_000;

// 平台会把超时或被取消的一轮约 15 分钟后带着原来的 scheduledTime 重投，晚投时也会迟到几分钟到一小时。
// 迟到超过这个时长的一轮改按收到的时刻跑：照旧 scheduledTime 跑会用旧时间覆盖 LAG 的 updatedAt，core 随即误报 stale。
export const LATE_ROUND_MS = 2 * 60_000;

export function isLateRound(scheduledTime: number, now = Date.now()): boolean {
  return now - scheduledTime > LATE_ROUND_MS;
}

export function roundTime(scheduledTime: number, now: number): number {
  return isLateRound(scheduledTime, now) ? now : scheduledTime;
}

export type SlotClaimer = { claim(slots: Record<string, number>): Promise<string[]> };

// 每个任务按自己的周期分格，格内第一轮就跑：Cloudflare 晚投或漏投排定的那一分钟时，格内后面任一轮补上。
// 认领不设超时：超时后认领仍可能写进去，这时退回跑的任务和已认领的对不上，被认领的那几格就整格漏掉。
// 调用失败时退回只跑正好到期的任务，这一轮补不了格，但到期的任务照跑。
export async function claimDueJobs(time: number, jobs: readonly Job[] = JOBS, slots?: SlotClaimer): Promise<Job[]> {
  if (!slots) return dueJobs(time, jobs);
  try {
    const claimed = new Set(await slots.claim(Object.fromEntries(jobs.map((job) => [job.name, slotStart(job, time)]))));
    return jobs.filter((job) => claimed.has(job.name));
  } catch (error) {
    console.warn(JSON.stringify({ event: "collector-slot-claim", detail: explain(error) }));
    return dueJobs(time, jobs);
  }
}

export async function runScheduled(
  env: Env,
  time: number,
  options: { jobs?: readonly Job[]; headStartMs?: number; slots?: SlotClaimer } = {},
): Promise<CollectorJobOutcome[]> {
  const run = (job: Job) => runJob(job, env, { now: time, scheduled: true });
  const due = await claimDueJobs(time, options.jobs, options.slots);
  const first = due.filter((job) => job.headStart).map(run);
  const rest = due.filter((job) => !job.headStart);
  if (first.length && rest.length) {
    const headStart = new AbortController();
    await Promise.race([
      Promise.allSettled(first),
      sleep(options.headStartMs ?? HEAD_START_MS, undefined, { signal: headStart.signal }),
    ]);
    headStart.abort();
  }
  const settled = await Promise.allSettled([...first, ...rest.map(run)]);
  return settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
}

export async function runNamed(
  env: Env,
  names: readonly string[],
  options: { jobs?: readonly Job[] } = {},
): Promise<CollectorJobOutcome[]> {
  return Promise.all([...new Set(names)].map((name) => {
    const job = findJob(name, options.jobs);
    if (job) return runJob(job, env);
    if ((RETIRED_COLLECTOR_JOBS as readonly string[]).includes(name)) {
      return Promise.resolve<CollectorJobOutcome>({ job: name, status: "skipped", detail: "Retired job", ms: 0 });
    }
    return Promise.resolve<CollectorJobOutcome>({ job: name, status: "error", detail: "unknown job", ms: 0 });
  }));
}
