import type { VercelMetricsPayload } from "@/lib/vercel-deployments-types";

const FUNCTIONS_ALIGN_MS = 900_000;
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

export async function fetchVercelFunctionsGroup(project: string, team: string, token: string, now = Date.now()): Promise<NonNullable<VercelMetricsPayload["functions"]>> {
  const end = Math.floor(now / FUNCTIONS_ALIGN_MS) * FUNCTIONS_ALIGN_MS, start = end - FUNCTIONS_WINDOW_MS;
  return { ...await fetchVercelFunctions(project, team, token, start, end), fetchedAt: Date.now(), start, end };
}

export async function fetchVercelAnalyticsGroup(project: string, team: string, token: string, now = Date.now()): Promise<NonNullable<VercelMetricsPayload["analytics"]>> {
  const end = Math.floor(now / 86_400_000) * 86_400_000, start = end - 7 * 86_400_000;
  const url = new URL("https://api.vercel.com/v1/query/web-analytics/visits/count");
  url.search = new URLSearchParams({
    teamId: team, projectId: project, since: new Date(start).toISOString(), until: new Date(end).toISOString(),
  }).toString();
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "User-Agent": "lyjwpage-vercel-status" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Vercel 指标查询失败 (${response.status})`);
  return { ...parseVercelAnalytics(await response.json()), fetchedAt: Date.now() };
}
