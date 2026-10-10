import { LAG_KEYS, readLag, writeLag, type LagStore } from "@shared/lag";
import { fetchWorkerDeployments, fetchWorkersMetrics, type WorkerDeploymentFetch } from "@/lib/cloudflare-workers";
import { CLOUDFLARE_WORKERS, type CloudflareDeploymentsPayload, type WorkerDeployment } from "@/lib/cloudflare-workers-types";

import { ok, settings, skipMissing, type Job } from "../job";

const CLOUDFLARE_SETTINGS = ["CLOUDFLARE_METRICS_TOKEN", "CLOUDFLARE_ACCOUNT_ID"] as const;

const WINDOW_ALIGN_MS = 15 * 60_000;
const WINDOW_MS = 12 * 3_600_000;

function activeVersionId(deployment: WorkerDeployment): string | undefined {
  return [...deployment.versions].sort((a, b) => b.percentage - a.percentage)[0]?.id;
}

// 构建或版本列表失败时这一轮的提交是空的；流量最高的版本没变就留着上一份。
function keepCommit(next: WorkerDeployment | null, prior: WorkerDeployment | null): WorkerDeployment | null {
  if (!next || next.commit || !prior?.commit) return next;
  return activeVersionId(next) === activeVersionId(prior) ? { ...next, commit: prior.commit } : next;
}

// 失败不是「没有部署」：空列表才清空这一格，读失败沿用上一份，超时或空响应不能把好数据盖掉。
export async function refreshCloudflareDeployments(
  lag: LagStore,
  load: () => Promise<WorkerDeploymentFetch[]>,
  now = Date.now(),
): Promise<{ failed: string[] }> {
  const previous = (await readLag<CloudflareDeploymentsPayload>(lag, LAG_KEYS.cloudflareDeployments))?.data ?? null;
  const fetched = await load();
  const failed: string[] = [];
  const workers = CLOUDFLARE_WORKERS.map(({ name }, index) => {
    const row = fetched[index];
    const prior = previous?.workers.find((worker) => worker.name === name)?.deployment ?? null;
    if (!row || row.error) {
      failed.push(name);
      console.warn(`[cloudflare-deployments] ${name} 读取失败：${row?.error ?? "没有这一格的结果"}`);
      return { name, deployment: prior };
    }
    return { name, deployment: keepCommit(row.deployment, prior) };
  });
  if (failed.length === CLOUDFLARE_WORKERS.length) throw new Error("Cloudflare 部署一个都没取到");
  await writeLag(lag, LAG_KEYS.cloudflareDeployments, { fetchedAt: now, workers }, now);
  return { failed };
}

export const cloudflareDeploymentsJob: Job = {
  name: "cloudflare-deployments",
  everyMinutes: 2,
  offset: 0,
  maxRuntimeMinutes: 2,
  async run({ env }) {
    const config = settings(env, CLOUDFLARE_SETTINGS);
    if ("missing" in config) return skipMissing("cloudflare-deployments", config.missing);
    const { CLOUDFLARE_METRICS_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account } = config.values;
    const { failed } = await refreshCloudflareDeployments(env.LAG, () => fetchWorkerDeployments(account, token));
    return ok(failed.length ? `${failed.join(", ")} carried over` : undefined);
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
