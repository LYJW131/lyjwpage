import { AwaitingReport } from "@/lib/awaiting-report";
import {
  CLOUDFLARE_WORKERS,
  type CloudflareDeploymentsPayload,
  type CloudflareMetricsPayload,
  type CloudflareWorkersPayload,
  type WorkerDeployment,
} from "@/lib/cloudflare-workers-types";
import { LagResult } from "@/lib/lag-result";
import { readLagEntry } from "@/lib/lag-store";
import { LAG_KEYS } from "@shared/lag";

const API = "https://api.cloudflare.com/client/v4";

// 汇总不带 status / 时间维度：直接取整段窗口的 P50，不能平均各小时的 P50。
// 名单和卡片共用 CLOUDFLARE_WORKERS，只在那一处改。
export const WORKERS_METRICS_QUERY = `
query WorkersMetrics($account: string, $start: Time, $end: Time) {
  viewer { accounts(filter: { accountTag: $account }) {
    summary: workersInvocationsAdaptive(limit: 10, filter: {
      scriptName_in: ${JSON.stringify(CLOUDFLARE_WORKERS.map(({ name }) => name))},
      datetime_geq: $start, datetime_lt: $end
    }) {
      dimensions { scriptName }
      sum { requests errors subrequests }
      quantiles { cpuTimeP50 }
    }
  } }
}`;

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Cloudflare 指标格式无效");
  }
  return value as Record<string, unknown>;
}

function nonnegative(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error("Cloudflare 指标数值无效");
  }
  return value;
}

export function parseWorkersMetrics(raw: unknown, windowStart: number, windowEnd: number): CloudflareMetricsPayload {
  const body = record(raw);
  if (body.errors != null && (!Array.isArray(body.errors) || body.errors.length > 0)) {
    throw new Error("Cloudflare 统计查询失败");
  }
  const accounts = record(record(body.data).viewer).accounts;
  if (!Array.isArray(accounts) || accounts.length !== 1) throw new Error("Cloudflare 统计账号不可用");
  const account = record(accounts[0]);
  if (!Array.isArray(account.summary)) throw new Error("Cloudflare 统计数据缺失");
  const summaries = account.summary.map(record);
  return {
    fetchedAt: windowEnd,
    windowStart,
    windowEnd,
    workers: CLOUDFLARE_WORKERS.map(({ name }) => {
      const summary = summaries.find((row) => record(row.dimensions).scriptName === name);
      const sum = summary ? record(summary.sum) : null;
      const cpu = summary ? record(summary.quantiles).cpuTimeP50 : null;
      return {
        name,
        metrics: sum ? {
          requests: nonnegative(sum.requests),
          errors: nonnegative(sum.errors),
          subrequests: nonnegative(sum.subrequests),
          // GraphQL cpuTimeP50 单位为微秒；公开契约统一为毫秒。
          cpuTimeP50Ms: cpu == null ? null : nonnegative(cpu) / 1000,
        } : null,
      };
    }),
  };
}

export function parseWorkerDeployment(raw: unknown): WorkerDeployment | null {
  const body = record(raw);
  if (body.success !== true) throw new Error("Cloudflare 部署查询失败");
  const deployments = record(body.result).deployments;
  if (!Array.isArray(deployments)) throw new Error("Cloudflare 部署格式无效");
  const latest = deployments.map(record).sort((a, b) => Date.parse(String(b.created_on)) - Date.parse(String(a.created_on)))[0];
  if (!latest) return null;
  const deployedAt = Date.parse(String(latest.created_on));
  if (!Number.isFinite(deployedAt) || !Array.isArray(latest.versions)) throw new Error("Cloudflare 部署版本无效");
  const versions = latest.versions.map((value) => {
    const version = record(value);
    if (typeof version.version_id !== "string" || !version.version_id) throw new Error("Cloudflare 部署版本无效");
    const percentage = nonnegative(version.percentage);
    if (percentage > 100) throw new Error("Cloudflare 部署流量无效");
    return { id: version.version_id, percentage };
  }).filter((version) => version.percentage > 0);
  return versions.length ? { deployedAt, versions, commit: null } : null;
}

/** 部署接口只给版本号：用版本号批量查构建历史，把提交拼回去。 */
export function parseBuildsByVersion(raw: unknown): Map<string, NonNullable<WorkerDeployment["commit"]>> {
  const body = record(raw);
  if (body.success !== true) throw new Error("Cloudflare 构建查询失败");
  const builds = record(body.result).builds;
  if (typeof builds !== "object" || builds === null || Array.isArray(builds)) throw new Error("Cloudflare 构建格式无效");
  const commits = new Map<string, NonNullable<WorkerDeployment["commit"]>>();
  for (const [versionId, value] of Object.entries(builds)) {
    const meta = record(value).build_trigger_metadata == null ? {} : record(record(value).build_trigger_metadata);
    const sha = typeof meta.commit_hash === "string" && /^[a-f0-9]{40}$/i.test(meta.commit_hash) ? meta.commit_hash : null;
    if (!sha) continue;
    commits.set(versionId, {
      sha,
      branch: typeof meta.branch === "string" ? meta.branch.slice(0, 100) : null,
      message: typeof meta.commit_message === "string" ? meta.commit_message.split("\n")[0].slice(0, 180) : null,
    });
  }
  return commits;
}

function apiRequest(account: string, token: string) {
  const signal = AbortSignal.timeout(8_000);
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  return async (path: string, body?: object): Promise<unknown> => {
    const response = await fetch(`${API}${path}`, {
      method: body ? "POST" : "GET", headers, signal,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error(`Cloudflare 查询失败 (${response.status})`);
    return response.json();
  };
}

/** 只在 API Worker 执行。起止由调用方给定，便于测试固定窗口。 */
export async function fetchWorkersMetrics(account: string, token: string, windowStart: number, windowEnd: number): Promise<CloudflareMetricsPayload> {
  const raw = await apiRequest(account, token)("/graphql", {
    query: WORKERS_METRICS_QUERY,
    variables: { account, start: new Date(windowStart).toISOString(), end: new Date(windowEnd).toISOString() },
  });
  return parseWorkersMetrics(raw, windowStart, windowEnd);
}

/** 版本列表，按版本号新到旧。 */
export function parseVersionList(raw: unknown): { id: string; number: number }[] {
  const body = record(raw);
  if (body.success !== true) throw new Error("Cloudflare 版本查询失败");
  const items = record(body.result).items;
  if (!Array.isArray(items)) throw new Error("Cloudflare 版本格式无效");
  return items.map((value) => {
    const version = record(value);
    if (typeof version.id !== "string" || !version.id || typeof version.number !== "number") throw new Error("Cloudflare 版本无效");
    return { id: version.id, number: version.number };
  }).sort((a, b) => b.number - a.number);
}

/** 往前翻多少个版本找构建记录；连续改几次密钥也能翻到那次 Git 部署。 */
const VERSION_LOOKBACK = 8;
const BUILDS_BATCH = 10;

export async function fetchWorkerDeployments(account: string, token: string): Promise<(WorkerDeployment | null)[]> {
  const request = apiRequest(account, token);
  const scripts = `/accounts/${encodeURIComponent(account)}/workers/scripts`;
  const [deployments, versions] = await Promise.all([
    Promise.all(CLOUDFLARE_WORKERS.map(async ({ name }) => {
      // 部署权限不足不吞掉可用指标，卡片明确显示版本暂不可用。
      try {
        return parseWorkerDeployment(await request(`${scripts}/${name}/deployments`));
      } catch { return null; }
    })),
    // 改密钥、控制台上传生成的版本没有构建记录，但代码和它前一个版本一样：
    // 顺着版本号往前找最近一个有构建的。列表查不到只是没有这条回退。
    Promise.all(CLOUDFLARE_WORKERS.map(async ({ name }) => {
      try {
        return parseVersionList(await request(`${scripts}/${name}/versions?per_page=${VERSION_LOOKBACK}`));
      } catch { return []; }
    })),
  ]);
  const versionIds = [...new Set([
    ...deployments.flatMap((deployment) => deployment?.versions.map((version) => version.id) ?? []),
    ...versions.flat().map((version) => version.id),
  ])];
  if (!versionIds.length) return deployments;
  // 构建接口一次最多查 20 个版本号（超出 400），分批；查不到（权限收紧）只空着提交，不连累部署时间与版本。
  const commits = new Map<string, NonNullable<WorkerDeployment["commit"]>>();
  await Promise.all(Array.from({ length: Math.ceil(versionIds.length / BUILDS_BATCH) }, (_, i) =>
    request(`/accounts/${encodeURIComponent(account)}/builds/builds?version_ids=${
      versionIds.slice(i * BUILDS_BATCH, (i + 1) * BUILDS_BATCH).map(encodeURIComponent).join(",")}`)
      .then((raw) => { for (const [id, commit] of parseBuildsByVersion(raw)) commits.set(id, commit); })
      .catch(() => undefined),
  ));
  return deployments.map((deployment, i) => {
    if (!deployment) return deployment;
    const active = [...deployment.versions].sort((a, b) => b.percentage - a.percentage);
    const direct = active.map((version) => commits.get(version.id)).find((item) => item != null);
    if (direct) return { ...deployment, commit: direct };
    const current = versions[i].find((version) => version.id === active[0]?.id);
    const previous = current
      ? versions[i].filter((version) => version.number < current.number).map((version) => commits.get(version.id)).find((item) => item != null)
      : undefined;
    return { ...deployment, commit: previous ?? null };
  });
}

/**
 * 公开端点：统计（每 15 分钟）和部署（每 2 分钟）是采集 Worker 各自写的两条键，按名字
 * 拼成卡片要的一份。两半各带采集时刻；信封的 `updatedAt` 取两半里较新的那个。
 * 两条都还没写过才是等采集。
 */
export async function getCloudflareWorkers(): Promise<LagResult<CloudflareWorkersPayload>> {
  const [metrics, deployments] = await Promise.all([
    readLagEntry<CloudflareMetricsPayload>(LAG_KEYS.cloudflareMetrics),
    readLagEntry<CloudflareDeploymentsPayload>(LAG_KEYS.cloudflareDeployments),
  ]);
  if (!metrics && !deployments) throw new AwaitingReport("Waiting for the first Workers check");
  const metricsByName = new Map(metrics?.data.workers.map((worker) => [worker.name, worker.metrics]));
  const deploymentByName = new Map(deployments?.data.workers.map((worker) => [worker.name, worker.deployment]));
  return new LagResult<CloudflareWorkersPayload>({
    fetchedAt: metrics?.data.fetchedAt ?? null,
    windowStart: metrics?.data.windowStart ?? null,
    windowEnd: metrics?.data.windowEnd ?? null,
    deploymentsFetchedAt: deployments?.data.fetchedAt ?? null,
    workers: CLOUDFLARE_WORKERS.map(({ name }) => ({
      name,
      metrics: metricsByName.get(name) ?? null,
      deployment: deploymentByName.get(name) ?? null,
    })),
  }, Math.max(metrics?.updatedAt ?? 0, deployments?.updatedAt ?? 0));
}
