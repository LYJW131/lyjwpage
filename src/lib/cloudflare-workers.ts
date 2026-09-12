import { cached, get, put } from "@/lib/cache";
import {
  CLOUDFLARE_WORKERS,
  type CloudflareWorkersPayload,
  type WorkerDeployment,
} from "@/lib/cloudflare-workers-types";
import { getServiceTrends } from "@/lib/service-trends";

const TTL_MS = 15 * 60_000;
const LAST_GOOD_TTL_MS = 86_400_000;
const BUCKET_MS = 900_000;
const API = "https://api.cloudflare.com/client/v4";

// 汇总不带 status / 时间维度：直接取整段窗口的 P50，不能平均各小时的 P50。
export const WORKERS_METRICS_QUERY = `
query WorkersMetrics($account: string, $start: Time, $end: Time) {
  viewer { accounts(filter: { accountTag: $account }) {
    summary: workersInvocationsAdaptive(limit: 10, filter: {
      scriptName_in: ["api", "online-counter", "playstation-reporter"],
      datetime_geq: $start, datetime_lt: $end
    }) {
      dimensions { scriptName }
      sum { requests errors subrequests }
      quantiles { cpuTimeP50 }
    }
    series: workersInvocationsAdaptive(limit: 500, filter: {
      scriptName_in: ["api", "online-counter", "playstation-reporter"],
      datetime_geq: $start, datetime_lt: $end
    }, orderBy: [datetimeFifteenMinutes_ASC]) {
      dimensions { scriptName datetimeFifteenMinutes }
      sum { requests }
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

export function parseWorkersMetrics(raw: unknown, windowStart: number, windowEnd: number): CloudflareWorkersPayload {
  const body = record(raw);
  if (body.errors != null && (!Array.isArray(body.errors) || body.errors.length > 0)) {
    throw new Error("Cloudflare 统计查询失败");
  }
  const accounts = record(record(body.data).viewer).accounts;
  if (!Array.isArray(accounts) || accounts.length !== 1) throw new Error("Cloudflare 统计账号不可用");
  const account = record(accounts[0]);
  if (!Array.isArray(account.summary) || !Array.isArray(account.series)) throw new Error("Cloudflare 统计数据缺失");
  const summaries = account.summary.map(record);
  const series = account.series.map(record);
  return {
    fetchedAt: windowEnd,
    windowStart,
    windowEnd,
    workers: CLOUDFLARE_WORKERS.map(({ name }) => {
      const summary = summaries.find((row) => record(row.dimensions).scriptName === name);
      const sum = summary ? record(summary.sum) : null;
      const cpu = summary ? record(summary.quantiles).cpuTimeP50 : null;
      const points = new Map<number, number>();
      for (const row of series) {
        const dimensions = record(row.dimensions);
        if (dimensions.scriptName !== name) continue;
        const at = Date.parse(String(dimensions.datetimeFifteenMinutes));
        if (!Number.isFinite(at)) throw new Error("Cloudflare 统计时间无效");
        points.set(at, nonnegative(record(row.sum).requests));
      }
      const firstBucket = Math.floor(windowStart / BUCKET_MS) * BUCKET_MS;
      return {
        name,
        metrics: sum ? {
          requests: nonnegative(sum.requests),
          errors: nonnegative(sum.errors),
          subrequests: nonnegative(sum.subrequests),
          // GraphQL cpuTimeP50 单位为微秒；公开契约统一为毫秒。
          cpuTimeP50Ms: cpu == null ? null : nonnegative(cpu) / 1000,
        } : null,
        history: summary ? Array.from({ length: Math.ceil((windowEnd - firstBucket) / BUCKET_MS) }, (_, i) => {
          const at = firstBucket + i * BUCKET_MS;
          return { at, requests: points.get(at) ?? 0 };
        }) : [],
        deployment: null,
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

/** 只在 API Worker 执行。起止由调用方给定，与 Vercel 函数趋势同一次刷新、同一窗口。 */
export async function fetchWorkersMetrics(account: string, token: string, windowStart: number, windowEnd: number): Promise<CloudflareWorkersPayload> {
  const raw = await apiRequest(account, token)("/graphql", {
    query: WORKERS_METRICS_QUERY,
    variables: { account, start: new Date(windowStart).toISOString(), end: new Date(windowEnd).toISOString() },
  });
  return parseWorkersMetrics(raw, windowStart, windowEnd);
}

export async function fetchWorkerDeployments(account: string, token: string): Promise<(WorkerDeployment | null)[]> {
  const request = apiRequest(account, token);
  const deployments = await Promise.all(CLOUDFLARE_WORKERS.map(async ({ name }) => {
    // 部署权限不足不吞掉可用指标，卡片明确显示版本暂不可用。
    try {
      return parseWorkerDeployment(await request(`/accounts/${encodeURIComponent(account)}/workers/scripts/${name}/deployments`));
    } catch { return null; }
  }));
  const versionIds = [...new Set(deployments.flatMap((deployment) => deployment?.versions.map((version) => version.id) ?? []))];
  if (!versionIds.length) return deployments;
  // 构建记录查不到（手动上传、权限收紧）只空着提交，不连累部署时间与版本。
  const commits = await request(
    `/accounts/${encodeURIComponent(account)}/builds/builds?version_ids=${versionIds.map(encodeURIComponent).join(",")}`,
  ).then(parseBuildsByVersion).catch(() => new Map<string, NonNullable<WorkerDeployment["commit"]>>());
  return deployments.map((deployment) => {
    if (!deployment) return deployment;
    const commit = [...deployment.versions]
      .sort((a, b) => b.percentage - a.percentage)
      .map((version) => commits.get(version.id))
      .find((item) => item != null) ?? null;
    return { ...deployment, commit };
  });
}

/** 部署版本独立缓存；失败沿用上次版本，全无才报空。 */
export async function getWorkerDeployments(account: string, token: string): Promise<(WorkerDeployment | null)[]> {
  const key = `cloudflare-deployments:v1:${account}`;
  return cached(key, TTL_MS, async () => {
    try {
      const data = await fetchWorkerDeployments(account, token);
      await put(`${key}:last-good`, data, LAST_GOOD_TTL_MS);
      return data;
    } catch {
      return await get<(WorkerDeployment | null)[]>(`${key}:last-good`) ?? CLOUDFLARE_WORKERS.map(() => null);
    }
  });
}

/** 趋势与 Vercel 同一次刷新、同一窗口；上游失败沿用最后成功值，保留原时间供卡片标注陈旧。 */
export async function getCloudflareWorkers(): Promise<CloudflareWorkersPayload> {
  const token = process.env.CLOUDFLARE_METRICS_TOKEN?.trim();
  const account = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (!token || !account) throw new Error("Cloudflare 统计未配置");
  const vercelProject = process.env.VERCEL_PROJECT_ID?.trim();
  const vercelTeam = process.env.VERCEL_TEAM_ID?.trim();
  const vercelToken = process.env.VERCEL_TOKEN?.trim();
  const [trends, deployments] = await Promise.all([
    getServiceTrends(
      vercelProject && vercelTeam && vercelToken ? { project: vercelProject, team: vercelTeam, token: vercelToken } : null,
      { account, token },
    ).catch(() => null),
    getWorkerDeployments(account, token),
  ]);
  const side = trends?.workers ?? null;
  if (!side) throw new Error("Cloudflare 统计暂不可用");
  return {
    ...side.data,
    fetchedAt: side.fetchedAt,
    workers: side.data.workers.map((worker, i) => ({ ...worker, deployment: deployments[i] ?? null })),
  };
}
