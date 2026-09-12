import { cached, get, put } from "@/lib/cache";
import {
  CLOUDFLARE_WORKERS,
  type CloudflareWorkersPayload,
  type WorkerDeployment,
} from "@/lib/cloudflare-workers-types";

const TTL_MS = 5 * 60_000;
const LAST_GOOD_TTL_MS = 86_400_000;
const HOUR_MS = 3_600_000;
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
    series: workersInvocationsAdaptive(limit: 100, filter: {
      scriptName_in: ["api", "online-counter", "playstation-reporter"],
      datetime_geq: $start, datetime_lt: $end
    }, orderBy: [datetimeHour_ASC]) {
      dimensions { scriptName datetimeHour }
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
        const at = Date.parse(String(dimensions.datetimeHour));
        if (!Number.isFinite(at)) throw new Error("Cloudflare 统计时间无效");
        points.set(at, nonnegative(record(row.sum).requests));
      }
      const firstHour = Math.floor(windowStart / HOUR_MS) * HOUR_MS;
      return {
        name,
        metrics: sum ? {
          requests: nonnegative(sum.requests),
          errors: nonnegative(sum.errors),
          subrequests: nonnegative(sum.subrequests),
          // GraphQL cpuTimeP50 单位为微秒；公开契约统一为毫秒。
          cpuTimeP50Ms: cpu == null ? null : nonnegative(cpu) / 1000,
        } : null,
        history: summary ? Array.from({ length: Math.ceil((windowEnd - firstHour) / HOUR_MS) }, (_, i) => {
          const at = firstHour + i * HOUR_MS;
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
  return versions.length ? { deployedAt, versions } : null;
}

/** 只在 API Worker 执行。令牌不进入公开信封、页面环境或日志。 */
export async function fetchCloudflareWorkers(account: string, token: string): Promise<CloudflareWorkersPayload> {
  const windowEnd = Date.now();
  const windowStart = windowEnd - 86_400_000;
  const signal = AbortSignal.timeout(8_000);
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  const request = async (path: string, body?: object): Promise<unknown> => {
    const response = await fetch(`${API}${path}`, {
      method: body ? "POST" : "GET", headers, signal,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error(`Cloudflare 查询失败 (${response.status})`);
    return response.json();
  };
  const [metrics, ...deployments] = await Promise.all([
    request("/graphql", {
      query: WORKERS_METRICS_QUERY,
      variables: { account, start: new Date(windowStart).toISOString(), end: new Date(windowEnd).toISOString() },
    }).then((raw) => parseWorkersMetrics(raw, windowStart, windowEnd)),
    ...CLOUDFLARE_WORKERS.map(async ({ name }) => {
      // 部署权限不足不吞掉可用指标，卡片明确显示版本暂不可用。
      try {
        return parseWorkerDeployment(await request(`/accounts/${encodeURIComponent(account)}/workers/scripts/${name}/deployments`));
      } catch { return null; }
    }),
  ]);
  return { ...metrics, workers: metrics.workers.map((worker, i) => ({ ...worker, deployment: deployments[i] })) };
}

/** SQLite 缓存五分钟；上游失败沿用最后成功值，保留原时间供卡片标注陈旧。 */
export async function getCloudflareWorkers(): Promise<CloudflareWorkersPayload> {
  const token = process.env.CLOUDFLARE_METRICS_TOKEN?.trim();
  const account = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  if (!token || !account) throw new Error("Cloudflare 统计未配置");
  const key = `cloudflare-workers:v1:${account}`;
  return cached(key, TTL_MS, async () => {
    try {
      const data = await fetchCloudflareWorkers(account, token);
      await put(`${key}:last-good`, data, LAST_GOOD_TTL_MS);
      return data;
    } catch {
      const previous = await get<CloudflareWorkersPayload>(`${key}:last-good`);
      if (previous) return previous;
      throw new Error("Cloudflare 统计暂不可用");
    }
  });
}
