import { cached, get, put } from "@/lib/cache";
import type { VercelMetricWindow, VercelMetricsPayload, VercelWebVitals } from "@/lib/vercel-deployments-types";

const FUNCTIONS_TTL_MS = 900_000;
const FUNCTIONS_WINDOW_MS = 12 * 3_600_000;

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

/** 只取整段窗口的 summary；窗口内没有调用时 summary 为空数组，视为 0。 */
export function parseVercelFunctions(raw: unknown) {
  const response = record(raw);
  if (!Array.isArray(response.summary) || response.summary.length > 1) throw new Error("Vercel 调用统计缺失");
  if (!response.summary.length) return { invocations: 0, errors: 0, timeouts: 0, cpuP75Ms: null, memoryAvgMb: null };
  const row = record(response.summary[0]);
  const invocations = count(row.total), errors = count(row.errors), timeouts = count(row.timeouts);
  if (errors + timeouts > invocations) throw new Error("Vercel 调用统计无效");
  return { invocations, errors, timeouts, cpuP75Ms: value(row.cpuP75Ms), memoryAvgMb: value(row.memoryAvgMb) };
}

export function parseVercelAnalytics(raw: unknown) {
  const response = record(raw), query = record(response.query), data = record(response.data);
  const start = typeof query.since === "string" ? Date.parse(query.since) : NaN;
  const end = typeof query.until === "string" ? Date.parse(query.until) : NaN;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) throw new Error("Vercel 访问统计窗口无效");
  return { start, end, pageviews: count(data.pageviews), visitors: count(data.visitors) };
}

/**
 * 每组独立缓存；失败时沿用 last-good（保留原采集时间）。从未成功过就把错误抛给 `cached`，
 * 只进它 5 秒的负缓存 —— 不能把 null 按整段 TTL 存起来，否则一次失败要等十五分钟才重试。
 */
async function section<T extends VercelMetricWindow>(key: string, ttlMs: number, loader: () => Promise<T>): Promise<T | null> {
  try {
    return await cached<T>(key, ttlMs, async () => {
      try {
        const data = await loader();
        await put(`${key}:last-good`, data, 86_400_000);
        return data;
      } catch (error) {
        console.warn(`[vercel-metrics] ${key.split(":").at(-1)} 读取失败：${error instanceof Error ? error.message : String(error)}`);
        const previous = await get<T>(`${key}:last-good`);
        if (previous) return previous;
        throw error;
      }
    });
  } catch {
    return null;
  }
}

/** 只在 API Worker 执行。起止由调用方给定，便于测试固定窗口；只要 summary，不要分桶序列。 */
export async function fetchVercelFunctions(project: string, team: string, token: string, start: number, end: number) {
  const url = new URL("https://vercel.com/api/observability/metrics");
  url.search = new URLSearchParams({ teamId: team }).toString();
  const response = await fetch(url, {
    method: "POST",
    body: JSON.stringify({
      event: "serverlessFunctionInvocation", scope: { type: "project", ownerId: team, projectIds: [project] },
      startTime: new Date(start).toISOString(), endTime: new Date(end).toISOString(), granularity: { minutes: 15 },
      filter: "environment eq 'production'", summaryOnly: true, tailRollup: "truncate", limit: 500, reason: "observability_chart",
      rollups: {
        total: { measure: "count", aggregation: "sum" },
        errors: { measure: "count", aggregation: "sum", filter: "(errorCode ne '' and errorCode ne 'timeout') or httpStatus ge 500 and httpStatus ne 504" },
        timeouts: { measure: "count", aggregation: "sum", filter: "httpStatus eq 504 or errorCode eq 'timeout'" },
        cpuP75Ms: { measure: "functionCpuTimeMs", aggregation: "p75" },
        memoryAvgMb: { measure: "peakMemoryMb", aggregation: "avg" },
      },
    }),
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "lyjwpage-vercel-status" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Vercel 指标查询失败 (${response.status})`);
  return parseVercelFunctions(await response.json());
}

/** Worker 独立缓存各指标组；任何一组失效都不影响部署或其他指标。 */
export async function getVercelMetrics(project: string, team: string, token: string): Promise<VercelMetricsPayload> {
  // v2：v1 时代把失败的 null 按整段 TTL 存过，升键把线上那份直接作废。
  const prefix = `vercel-metrics:v2:${team}:${project}`;
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
    section(`${prefix}:speed`, 300_000, async () => {
      const end = Math.floor(Date.now() / 300_000) * 300_000, start = end - 7 * 86_400_000;
      const params = { tz: "Asia/Shanghai", from: new Date(start).toISOString(), to: new Date(end).toISOString(), environment: "production", projectId: project };
      const [desktop, mobile] = await Promise.all(["desktop", "mobile"].map(device => request("https://vercel.com/api/speed-insights/v2/timeseries", { ...params, device }).then(parseVercelWebVitals)));
      return { fetchedAt: Date.now(), start, end, desktop, mobile };
    }),
    section(`${prefix}:functions`, FUNCTIONS_TTL_MS, async () => {
      const end = Math.floor(Date.now() / FUNCTIONS_TTL_MS) * FUNCTIONS_TTL_MS, start = end - FUNCTIONS_WINDOW_MS;
      return { ...await fetchVercelFunctions(project, team, token, start, end), fetchedAt: Date.now(), start, end };
    }),
    section(`${prefix}:analytics`, 300_000, async () => {
      const end = Math.floor(Date.now() / 86_400_000) * 86_400_000, start = end - 7 * 86_400_000;
      const raw = await request("https://api.vercel.com/v1/query/web-analytics/visits/count", {
        projectId: project, since: new Date(start).toISOString(), until: new Date(end).toISOString(),
      });
      return { ...parseVercelAnalytics(raw), fetchedAt: Date.now() };
    }),
  ]);
  return { speed, functions, analytics };
}
