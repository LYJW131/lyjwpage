import type { CollectorJobOutcome } from "@shared/collector";
import { withRequestState } from "@shared/request-state";

import type { Env } from "./env";
import { explain, type Job, type JobResult } from "./job";
import { appleRecentJob } from "./jobs/apple-recent";
import { cloudflareDeploymentsJob, cloudflareMetricsJob } from "./jobs/cloudflare";
import { githubChartJob } from "./jobs/github-chart";
import { githubRepoJob } from "./jobs/github-repo";
import { pagespeedJob } from "./jobs/pagespeed";
import { providerStatusJob } from "./jobs/provider-status";
import { sentryStatusJob } from "./jobs/sentry-status";
import { vercelDeploymentsJob, vercelMetricsJob } from "./jobs/vercel";
import { checkinDue, isDue, monitorConfig, monitorSlug } from "./schedule";

/**
 * 全部定时任务。节奏按「每 N 分钟、第 offset 分钟」登记，cron 每分钟一响时挑出到期的；
 * 错开 offset 是为了别让几个慢任务挤在同一分钟。去向与监控名见 README 的任务表。
 */
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
];

export function findJob(name: string, jobs: readonly Job[] = JOBS): Job | undefined {
  return jobs.find((job) => job.name === name);
}

export function dueJobs(time: number, jobs: readonly Job[] = JOBS): Job[] {
  return jobs.filter((job) => isDue(job, time));
}

/**
 * Sentry 的 `withMonitor`，由入口注进来：这个文件不直接依赖 SDK，单测里就能跑，
 * 报到行为在测试里换成记录用的替身。
 */
export type MonitorRunner = <T>(slug: string, run: () => Promise<T>, config: ReturnType<typeof monitorConfig>) => Promise<T>;

/**
 * 任务真失败时报给 Sentry issue 的钩子，由入口注进来（同 MonitorRunner，这个文件不依赖 SDK）。
 * 监控名额有限、多出来的监控会被停用，靠它在 issue 里也能看到失败；已知的外部故障不报。
 */
export type FailureReporter = (job: Job["name"], error: Error) => void;

/** 监控要求报 error、但任务本身只是跳过：抛这个，外层按跳过记 */
class MonitorFailure extends Error {
  result: JobResult;
  constructor(result: JobResult) {
    super(result.failing);
    this.name = "MonitorFailure";
    this.result = result;
  }
}

/**
 * 跑一个任务：自己的请求作用域（cache.ts 的进程内副本不跨轮次），结构化日志，
 * 失败只落在自己身上、从不抛。给了 `monitor` 就包一层 Sentry 监控报到。
 */
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
    // 连着失败了好几轮：这一轮只是跳过，但该让人知道了
    if (error instanceof MonitorFailure) {
      options.report?.(job.name, new Error(error.message));
      return outcome(job, error.result.status, error.message, started);
    }
    const failed = outcome(job, "error", explain(error), started);
    // 已知的外部故障（error.outage）任务自己记过 warn 了，这里也只记 warn、不开 issue；监控照样报 error
    const outage = (error as { outage?: unknown } | null)?.outage === true;
    (outage ? console.warn : console.error)(JSON.stringify({ event: "collector-job", ...failed }));
    if (!outage) options.report?.(job.name, error instanceof Error ? error : new Error(explain(error)));
    return failed;
  }
}

function outcome(job: Job, status: CollectorJobOutcome["status"], detail: string | undefined, started: number): CollectorJobOutcome {
  return { job: job.name, status, ...(detail ? { detail } : {}), ms: Date.now() - started };
}

/**
 * 带 `headStart` 的任务先跑这么久（或先跑完），其余的再开跑。入口处有短超时的请求
 * 和同一分钟里的大批出站挤在一起时，会把超时预算耗在排队上。目前没有任务设置它。
 */
export const HEAD_START_MS = 3_000;

/**
 * cron 这一响：到期的任务并行跑，互不连累；带 `headStart` 的先起步。给了 `monitor`
 * 时，只在该报到的那几轮（见 schedule.ts）包上监控。
 */
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

/** RPC 与本地调试：点名就跑，不看节奏、不报到；不认识的名字按 error 回，不抛 */
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
