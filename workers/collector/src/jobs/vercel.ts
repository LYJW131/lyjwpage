import { LAG_KEYS, readLag, writeLag, type LagStore } from "@shared/lag";
import { fetchVercelDeployments } from "@/lib/vercel-deployments";
import type { VercelDeploymentsPayload, VercelMetricsPayload } from "@/lib/vercel-deployments-types";
import { fetchVercelAnalyticsGroup, fetchVercelFunctionsGroup } from "@/lib/vercel-metrics";

import { archiveSiteDeploys } from "../history";
import { explain, ok, settings, skipMissing, type Job } from "../job";

const VERCEL_SETTINGS = ["VERCEL_TOKEN", "VERCEL_PROJECT_ID", "VERCEL_TEAM_ID"] as const;

/**
 * Vercel 生产版本与最近几次部署。可滞后层里只放部署本身
 * （`{fetchedAt, production, recent}`）；函数与访问统计、PageSpeed 各是各的键。
 * 每次部署另外 upsert 进 D1 `site_deploys`，只有新增或状态变了的行产生写入。
 */
export const vercelDeploymentsJob: Job = {
  name: "vercel-deployments",
  everyMinutes: 1,
  offset: 0,
  maxRuntimeMinutes: 2,
  async run({ env }) {
    const config = settings(env, VERCEL_SETTINGS);
    if ("missing" in config) return skipMissing("vercel-deployments", config.missing);
    const { VERCEL_TOKEN: token, VERCEL_PROJECT_ID: project, VERCEL_TEAM_ID: team } = config.values;
    const { fetchedAt, production, recent }: VercelDeploymentsPayload = await fetchVercelDeployments(project, team, token);
    const data: VercelDeploymentsPayload = { fetchedAt, production, recent };
    await writeLag(env.LAG, LAG_KEYS.vercelDeployments, data, fetchedAt);
    if (env.HISTORY) await archiveSiteDeploys(env.HISTORY, [production, ...recent], fetchedAt);
    return ok();
  },
};

/**
 * 两组各拉各的：哪一组这轮失败，就沿用可滞后层里上一份的那一组（带着它原来的
 * 采集时刻，卡片据此标陈旧）。两组都失败才算这一轮失败、不写。
 */
export async function refreshVercelMetrics(
  lag: LagStore,
  load: { functions: () => Promise<VercelMetricsPayload["functions"]>; analytics: () => Promise<VercelMetricsPayload["analytics"]> },
  now = Date.now(),
): Promise<{ payload: VercelMetricsPayload; failed: string[] }> {
  const previous = (await readLag<VercelMetricsPayload>(lag, LAG_KEYS.vercelMetrics))?.data ?? null;
  const [functions, analytics] = await Promise.allSettled([load.functions(), load.analytics()]);
  const failed: string[] = [];
  const pick = <K extends keyof VercelMetricsPayload>(name: K, result: PromiseSettledResult<VercelMetricsPayload[K]>) => {
    if (result.status === "fulfilled") return result.value;
    failed.push(name);
    console.warn(`[vercel-metrics] ${name} 读取失败：${explain(result.reason)}`);
    return previous?.[name] ?? null;
  };
  const payload: VercelMetricsPayload = { functions: pick("functions", functions), analytics: pick("analytics", analytics) };
  if (failed.length === 2) throw new Error("Vercel 指标两组都没取到");
  await writeLag(lag, LAG_KEYS.vercelMetrics, payload, now);
  return { payload, failed };
}

export const vercelMetricsJob: Job = {
  name: "vercel-metrics",
  everyMinutes: 15,
  offset: 3,
  maxRuntimeMinutes: 2,
  async run({ env }) {
    const config = settings(env, VERCEL_SETTINGS);
    if ("missing" in config) return skipMissing("vercel-metrics", config.missing);
    const { VERCEL_TOKEN: token, VERCEL_PROJECT_ID: project, VERCEL_TEAM_ID: team } = config.values;
    const { failed } = await refreshVercelMetrics(env.LAG, {
      functions: () => fetchVercelFunctionsGroup(project, team, token),
      analytics: () => fetchVercelAnalyticsGroup(project, team, token),
    });
    return ok(failed.length ? `${failed.join(", ")} carried over` : undefined);
  },
};
