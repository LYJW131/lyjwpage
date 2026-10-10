import { LAG_KEYS, readLag, writeLag, type LagStore } from "@shared/lag";
import { fetchWorkerDeploymentAttempts, fetchWorkersMetrics, type WorkerDeploymentAttempt } from "@/lib/cloudflare-workers";
import { CLOUDFLARE_WORKERS, type CloudflareDeploymentsPayload } from "@/lib/cloudflare-workers-types";

import { ok, settings, skipMissing, type Job, type JobResult } from "../job";

const CLOUDFLARE_SETTINGS = ["CLOUDFLARE_METRICS_TOKEN", "CLOUDFLARE_ACCOUNT_ID"] as const;

const WINDOW_ALIGN_MS = 15 * 60_000;
const WINDOW_MS = 12 * 3_600_000;

export function mergeCloudflareDeployments(
  attempts: readonly WorkerDeploymentAttempt[],
  previous: CloudflareDeploymentsPayload | null,
  now: number,
): { workers: CloudflareDeploymentsPayload["workers"]; carried: string[] } {
  const prior = new Map(previous?.workers.map((worker) => [worker.name, worker]));
  const carried: string[] = [];
  const workers = CLOUDFLARE_WORKERS.map(({ name }, index) => {
    const attempt = attempts[index];
    if (!attempt || attempt.name !== name) throw new Error(`Cloudflare 部署结果和名单对不上：${name}`);
    if (attempt.ok) return { name, deployment: attempt.deployment, observedAt: now };
    const kept = prior.get(name);
    if (kept?.deployment) {
      carried.push(name);
      return { name, deployment: kept.deployment, observedAt: typeof kept.observedAt === "number" ? kept.observedAt : previous?.fetchedAt ?? 0 };
    }
    return { name, deployment: null, observedAt: 0 };
  });
  return { workers, carried };
}

export async function refreshCloudflareDeployments(
  lag: LagStore,
  load: () => Promise<readonly WorkerDeploymentAttempt[]>,
  now: number,
): Promise<JobResult> {
  const previous = (await readLag<CloudflareDeploymentsPayload>(lag, LAG_KEYS.cloudflareDeployments))?.data ?? null;
  const attempts = await load();
  const failed = attempts.filter((attempt) => !attempt.ok);
  if (failed.length === attempts.length) {
    throw new Error(`Cloudflare 部署一个都没取到：${failed.map((attempt) => `${attempt.name} ${attempt.error}`).join("; ")}`);
  }
  const { workers, carried } = mergeCloudflareDeployments(attempts, previous, now);
  for (const attempt of failed) {
    console.warn(`[cloudflare-deployments] ${attempt.name} 读取失败：${attempt.error}；${carried.includes(attempt.name) ? "沿用上一份" : "没有上一份"}`);
  }
  await writeLag(lag, LAG_KEYS.cloudflareDeployments, { fetchedAt: now, workers }, now);
  return ok(carried.length ? `${carried.join(", ")} carried over` : undefined);
}

export const cloudflareDeploymentsJob: Job = {
  name: "cloudflare-deployments",
  everyMinutes: 2,
  offset: 0,
  maxRuntimeMinutes: 2,
  async run({ env, now }) {
    const config = settings(env, CLOUDFLARE_SETTINGS);
    if ("missing" in config) return skipMissing("cloudflare-deployments", config.missing);
    const { CLOUDFLARE_METRICS_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account } = config.values;
    return refreshCloudflareDeployments(env.LAG, () => fetchWorkerDeploymentAttempts(account, token), now);
  },
};

export const cloudflareMetricsJob: Job = {
  name: "cloudflare-metrics",
  everyMinutes: 15,
  offset: 4,
  maxRuntimeMinutes: 2,
  async run({ env }) {
    const config = settings(env, CLOUDFLARE_SETTINGS);
    if ("missing" in config) return skipMissing("cloudflare-metrics", config.missing);
    const { CLOUDFLARE_METRICS_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account } = config.values;
    const windowEnd = Math.floor(Date.now() / WINDOW_ALIGN_MS) * WINDOW_ALIGN_MS;
    const metrics = { ...await fetchWorkersMetrics(account, token, windowEnd - WINDOW_MS, windowEnd), fetchedAt: Date.now() };
    await writeLag(env.LAG, LAG_KEYS.cloudflareMetrics, metrics, metrics.fetchedAt);
    return ok();
  },
};
