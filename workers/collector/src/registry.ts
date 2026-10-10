import type { CollectorJobOutcome } from "@shared/collector";
import { withRequestState } from "@shared/request-state";

import type { Env } from "./env";
import { explain, type Job, type JobResult } from "./job";
import { appleRecentJob } from "./jobs/apple-recent";
import { avatarWatchJob } from "./jobs/avatar-watch";
import { cloudflareDeploymentsJob, cloudflareMetricsJob } from "./jobs/cloudflare";
import { genshinProfileJob } from "./jobs/genshin-profile";
import { githubChartJob } from "./jobs/github-chart";
import { githubRepoJob } from "./jobs/github-repo";
import { pagespeedJob } from "./jobs/pagespeed";
import { providerStatusJob } from "./jobs/provider-status";
import { sentryStatusJob } from "./jobs/sentry-status";
import { vercelDeploymentsJob, vercelMetricsJob } from "./jobs/vercel";
import { checkinDue, isDue, monitorConfig, monitorSlug } from "./schedule";

export const JOBS: readonly Job[] = [
  appleRecentJob,
  providerStatusJob,
  pagespeedJob,
  githubChartJob,
  githubRepoJob,
  vercelDeploymentsJob,
  vercelMetricsJob,
  cloudflareDeploymentsJob,
  cloudflareMetricsJob,
  sentryStatusJob,
  avatarWatchJob,
  genshinProfileJob,
];

export function findJob(name: string, jobs: readonly Job[] = JOBS): Job | undefined {
  return jobs.find((job) => job.name === name);
}

export function dueJobs(time: number, jobs: readonly Job[] = JOBS): Job[] {
  return jobs.filter((job) => isDue(job, time));
}

export type MonitorRunner = <T>(slug: string, run: () => Promise<T>, config: ReturnType<typeof monitorConfig>) => Promise<T>;

export type FailureReporter = (job: Job["name"], error: Error) => void;

class MonitorFailure extends Error {
  result: JobResult;
  constructor(result: JobResult) {
    super(result.failing);
    this.name = "MonitorFailure";
    this.result = result;
  }
}

export async function runJob(
  job: Job,
  env: Env,
  options: { now?: number; scheduled?: boolean; monitor?: MonitorRunner; report?: FailureReporter } = {},
): Promise<CollectorJobOutcome> {
  const started = Date.now();
  const now = options.now ?? started;
  const execute = () => withRequestState(async () => {
    const result = await job.run({ env, now, scheduled: options.scheduled ?? false });
    if (options.monitor && result.failing) throw new MonitorFailure(result);
    return result;
  });
  try {
    const result = options.monitor
      ? await options.monitor(monitorSlug(job), execute, monitorConfig(job))
      : await execute();
    return outcome(job, result.status, result.detail ?? result.failing, started);
  } catch (error) {
    if (error instanceof MonitorFailure) {
      options.report?.(job.name, new Error(error.message));
      return outcome(job, error.result.status, error.message, started);
    }
    const failed = outcome(job, "error", explain(error), started);
    const outage = (error as { outage?: unknown } | null)?.outage === true;
    (outage ? console.warn : console.error)(JSON.stringify({ event: "collector-job", ...failed }));
    if (!outage) options.report?.(job.name, error instanceof Error ? error : new Error(explain(error)));
    return failed;
  }
}

function outcome(job: Job, status: CollectorJobOutcome["status"], detail: string | undefined, started: number): CollectorJobOutcome {
  return { job: job.name, status, ...(detail ? { detail } : {}), ms: Date.now() - started };
}

export const HEAD_START_MS = 3_000;

export async function runScheduled(
  env: Env,
  scheduledTime: number,
  options: { monitor?: MonitorRunner; report?: FailureReporter; jobs?: readonly Job[]; headStartMs?: number } = {},
): Promise<CollectorJobOutcome[]> {
  const run = (job: Job) => runJob(job, env, {
    now: scheduledTime,
    scheduled: true,
    monitor: options.monitor && checkinDue(job, scheduledTime) ? options.monitor : undefined,
    report: options.report,
  });
  const due = dueJobs(scheduledTime, options.jobs);
  const first = due.filter((job) => job.headStart).map(run);
  const rest = due.filter((job) => !job.headStart);
  if (first.length && rest.length) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      Promise.allSettled(first),
      new Promise((resolve) => { timer = setTimeout(resolve, options.headStartMs ?? HEAD_START_MS); }),
    ]);
    clearTimeout(timer);
  }
  const settled = await Promise.allSettled([...first, ...rest.map(run)]);
  return settled.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
}

export async function runNamed(
  env: Env,
  names: readonly string[],
  options: { jobs?: readonly Job[]; report?: FailureReporter } = {},
): Promise<CollectorJobOutcome[]> {
  return Promise.all([...new Set(names)].map((name) => {
    const job = findJob(name, options.jobs);
    return job ? runJob(job, env, { report: options.report }) : Promise.resolve<CollectorJobOutcome>({ job: name, status: "error", detail: "unknown job", ms: 0 });
  }));
}
