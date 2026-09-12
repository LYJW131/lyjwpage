import { cached, get, put } from "@/lib/cache";
import type { VercelMetricWindow, VercelMetricsPayload, VercelWebVitals } from "@/lib/vercel-deployments-types";

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Vercel 指标格式无效");
  return value as Record<string, unknown>;
}
function value(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) && raw >= 0 ? raw : null;
}
function count(raw: unknown): number {
  const result = value(raw);
  if (result == null || !Number.isSafeInteger(result)) throw new Error("Vercel 计数缺失");
  return result;
}

export function parseVercelWebVitals(raw: unknown): VercelWebVitals {
  const overview = record(record(raw).overview);
  const p75 = (key: string) => overview[key] == null ? null : value(record(overview[key]).p75);
  const score = p75("RES");
  return { score: score != null && score <= 100 ? score : null, lcpMs: p75("LCP"), inpMs: p75("INP"),
    cls: p75("CLS"), fcpMs: p75("FCP"), ttfbMs: p75("TTFB") };
}

export function parseVercelFunctions(raw: unknown) {
  const response = record(raw);
  if (!Array.isArray(response.data)) throw new Error("Vercel 调用趋势缺失");
  const history = response.data.map(rawPoint => {
    const point = record(rawPoint);
    const at = typeof point.timestamp === "string" ? Date.parse(point.timestamp) : NaN;
    if (!Number.isFinite(at)) throw new Error("Vercel 调用趋势时间无效");
    return { at, requests: count(point.total) };
  }).sort((a, b) => a.at - b.at);
  if (new Set(history.map(point => point.at)).size !== history.length) throw new Error("Vercel 调用趋势时间重复");
  if (!Array.isArray(response.summary) || response.summary.length > 1) throw new Error("Vercel 调用统计缺失");
  if (!response.summary.length) {
    if (!Array.isArray(response.data) || response.data.length) throw new Error("Vercel 调用统计不完整");
    return { invocations: 0, errors: 0, timeouts: 0, cpuP75Ms: null, memoryAvgMb: null, history };
  }
  const row = record(response.summary[0]);
  const invocations = count(row.total), errors = count(row.errors), timeouts = count(row.timeouts);
  if (errors + timeouts > invocations) throw new Error("Vercel 调用统计无效");
  return { invocations, errors, timeouts, cpuP75Ms: value(row.cpuP75Ms), memoryAvgMb: value(row.memoryAvgMb), history };
}

export function parseVercelAnalytics(raw: unknown) {
  const response = record(raw), query = record(response.query), data = record(response.data);
  const start = typeof query.since === "string" ? Date.parse(query.since) : NaN;
  const end = typeof query.until === "string" ? Date.parse(query.until) : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error("Vercel 访问统计窗口无效");
  return { start, end, pageviews: count(data.pageviews), visitors: count(data.visitors) };
}

async function section<T extends VercelMetricWindow>(key: string, loader: () => Promise<T>): Promise<T | null> {
  return cached<T | null>(key, 300_000, async () => {
    try {
      const data = await loader();
      await put(`${key}:last-good`, data, 86_400_000);
      return data;
    } catch {
      console.warn("[vercel-metrics] 指标读取失败，保留原采集时间");
      return await get<T>(`${key}:last-good`) ?? null;
    }
  });
}

/** Worker 独立缓存各指标组；任何一组失效都不影响部署或其他指标。 */
export async function getVercelMetrics(project: string, team: string, token: string): Promise<VercelMetricsPayload> {
  const prefix = `vercel-metrics:v1:${team}:${project}`;
  const request = async (path: string, params: Record<string, string> = {}, body?: unknown) => {
    const url = new URL(path);
    url.search = new URLSearchParams({ teamId: team, ...params }).toString();
    const response = await fetch(url, { method: body ? "POST" : "GET", body: body ? JSON.stringify(body) : undefined,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "lyjwpage-vercel-status" },
      signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Vercel 指标查询失败 (${response.status})`);
    return response.json();
  };
  const [speed, functions, analytics] = await Promise.all([
    section(`${prefix}:speed`, async () => {
      const end = Math.floor(Date.now() / 300_000) * 300_000, start = end - 7 * 86_400_000;
      const params = { tz: "Asia/Shanghai", from: new Date(start).toISOString(), to: new Date(end).toISOString(), environment: "production", projectId: project };
      const [desktop, mobile] = await Promise.all(["desktop", "mobile"].map(device => request("https://vercel.com/api/speed-insights/v2/timeseries", { ...params, device }).then(parseVercelWebVitals)));
      return { fetchedAt: Date.now(), start, end, desktop, mobile };
    }),
    section(`${prefix}:functions:v2`, async () => {
      const end = Math.floor(Date.now() / 300_000) * 300_000, start = end - 12 * 3_600_000;
      const raw = await request("https://vercel.com/api/observability/metrics", {}, {
        event: "serverlessFunctionInvocation", scope: { type: "project", ownerId: team, projectIds: [project] },
        startTime: new Date(start).toISOString(), endTime: new Date(end).toISOString(), granularity: { minutes: 5 },
        filter: "environment eq 'production'", summaryOnly: false, tailRollup: "truncate", limit: 500, reason: "observability_chart",
        rollups: {
          total: { measure: "count", aggregation: "sum" },
          errors: { measure: "count", aggregation: "sum", filter: "(errorCode ne '' and errorCode ne 'timeout') or httpStatus ge 500 and httpStatus ne 504" },
          timeouts: { measure: "count", aggregation: "sum", filter: "httpStatus eq 504 or errorCode eq 'timeout'" },
          cpuP75Ms: { measure: "functionCpuTimeMs", aggregation: "p75" },
          memoryAvgMb: { measure: "peakMemoryMb", aggregation: "avg" },
        },
      });
      return { ...parseVercelFunctions(raw), fetchedAt: Date.now(), start, end };
    }),
    section(`${prefix}:analytics`, async () => {
      const end = Math.floor(Date.now() / 86_400_000) * 86_400_000, start = end - 7 * 86_400_000;
      const raw = await request("https://api.vercel.com/v1/query/web-analytics/visits/count", {
        projectId: project, since: new Date(start).toISOString(), until: new Date(end).toISOString(),
      });
      return { ...parseVercelAnalytics(raw), fetchedAt: Date.now() };
    }),
  ]);
  return { speed, functions, analytics };
}
