import { LAG_KEYS, writeLag } from "@shared/lag";
import { fetchWorkerDeployments, fetchWorkersMetrics } from "@/lib/cloudflare-workers";
import { CLOUDFLARE_WORKERS, type CloudflareDeploymentsPayload } from "@/lib/cloudflare-workers-types";

import { ok, settings, skipMissing, type Job } from "../job";

const CLOUDFLARE_SETTINGS = ["CLOUDFLARE_METRICS_TOKEN", "CLOUDFLARE_ACCOUNT_ID"] as const;

/** 统计窗口滚动 12 小时，按 15 分钟对齐 */
const WINDOW_ALIGN_MS = 15 * 60_000;
const WINDOW_MS = 12 * 3_600_000;

/**
 * 本仓库各 Worker 当前部署的版本与提交，每 2 分钟一轮（站点部署后上报入口还会点名
 * 让它立刻重拉）。单个 Worker 查不到（还没部署过的脚本、权限收紧）只让那一格为空；
 * 全都查不到才算失败、不写。结果按名字存，名单再变也不会和旧数据错位。
 */
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
    // 逐个 Worker 的失败在里面就吞成了 null；一个都没取到就是令牌或接口整体出了问题，
    // 这时写进去会把上一份好的整份盖成空
    if (deployments.every((deployment) => deployment == null)) throw new Error("Cloudflare 部署一个都没取到");
    const data: CloudflareDeploymentsPayload = {
      fetchedAt,
      workers: CLOUDFLARE_WORKERS.map(({ name }, index) => ({ name, deployment: deployments[index] ?? null })),
    };
    await writeLag(env.LAG, LAG_KEYS.cloudflareDeployments, data, fetchedAt);
    return ok();
  },
};

/** 各 Worker 12 小时的调用、错误与 CPU，每 15 分钟一轮，和窗口对齐的节奏一致 */
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
