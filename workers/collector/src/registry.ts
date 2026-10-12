import { RETIRED_COLLECTOR_JOBS, type CollectorJobOutcome } from "@shared/collector";
import { withRequestState } from "@shared/request-state";

import type { Env } from "./env";
import { explain, type Job } from "./job";
import { appleRecentJob } from "./jobs/apple-recent";
import { cloudflareDeploymentsJob, cloudflareMetricsJob } from "./jobs/cloudflare";
import { githubChartJob } from "./jobs/github-chart";
import { githubRepoJob } from "./jobs/github-repo";
import { pagespeedJob } from "./jobs/pagespeed";
import { providerStatusJob } from "./jobs/provider-status";
import { siteHealthJob } from "./jobs/site-health";
import { siteAnalyticsJob, siteDeploymentsJob } from "./jobs/site-status";
import { uptimeProbeJob } from "./jobs/uptime-probe";
import { isDue } from "./schedule";

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
    if ((error as { outage?: unknown } | null)?.outage === true) console.warn(JSON.stringify({ event: "collector-job", ...failed }));
    else console.error(`[collector-job] ${job.name}`, error);
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
  options: { jobs?: readonly Job[]; headStartMs?: number } = {},
): Promise<CollectorJobOutcome[]> {
  const run = (job: Job) => runJob(job, env, { now: scheduledTime, scheduled: true });
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
