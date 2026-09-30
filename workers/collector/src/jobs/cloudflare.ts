import { LAG_KEYS, writeLag } from "@shared/lag";
import { fetchWorkerDeployments, fetchWorkersMetrics } from "@/lib/cloudflare-workers";
import { CLOUDFLARE_WORKERS, type CloudflareDeploymentsPayload } from "@/lib/cloudflare-workers-types";

import { ok, settings, skipMissing, type Job } from "../job";

const CLOUDFLARE_SETTINGS = ["CLOUDFLARE_METRICS_TOKEN", "CLOUDFLARE_ACCOUNT_ID"] as const;

const WINDOW_ALIGN_MS = 15 * 60_000;
const WINDOW_MS = 12 * 3_600_000;

export const cloudflareDeploymentsJob: Job = {
  name: "cloudflare-deployments",
  everyMinutes: 2,
  offset: 0,
  maxRuntimeMinutes: 2,
  async run({ env }) {
    const config = settings(env, CLOUDFLARE_SETTINGS);
    if ("missing" in config) return skipMissing("cloudflare-deployments", config.missing);
    const { CLOUDFLARE_METRICS_TOKEN: token, CLOUDFLARE_ACCOUNT_ID: account } = config.values;
    const fetchedAt = Date.now();
    const deployments = await fetchWorkerDeployments(account, token);
    if (deployments.every((deployment) => deployment == null)) throw new Error("Cloudflare 部署一个都没取到");
    const data: CloudflareDeploymentsPayload = {
      fetchedAt,
      workers: CLOUDFLARE_WORKERS.map(({ name }, index) => ({ name, deployment: deployments[index] ?? null })),
    };
    await writeLag(env.LAG, LAG_KEYS.cloudflareDeployments, data, fetchedAt);
    return ok();
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
