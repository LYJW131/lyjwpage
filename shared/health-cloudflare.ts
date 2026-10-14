import type { ErrorSeries, FieldVitals } from "@shared/health-types";

const API = "https://api.cloudflare.com/client/v4";

// 浏览器错误经 site Worker 的 /relay 打成日志，所以 site 一组同时包含服务端与浏览器错误。
export const HEALTH_SITE_SERVICES = ["site"] as const;
export const HEALTH_WORKER_SERVICES = ["core", "ai", "ingress", "collector"] as const;

type Json = Record<string, unknown>;

function record(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function parseErrorCounts(raw: unknown): Map<string, number> {
  const calculations = record(raw).calculations;
  if (!Array.isArray(calculations)) throw new Error("Workers Observability 查询格式无效");
  const counts = new Map<string, number>();
  for (const aggregate of calculations.flatMap((calc) => (Array.isArray(record(calc).aggregates) ? record(calc).aggregates as unknown[] : []))) {
    const row = record(aggregate);
    const service = Array.isArray(row.groups) ? row.groups.map(record).find((group) => group.key === "$metadata.service")?.value : undefined;
    if (typeof service === "string") counts.set(service, num(row.count));
  }
  return counts;
}

const sumOf = (counts: Map<string, number>, services: readonly string[]) =>
  services.reduce((sum, service) => sum + (counts.get(service) ?? 0), 0);

export const VITALS_QUERY = `
query FieldVitals($account: string, $sites: [string!], $start: Time, $end: Time) {
  viewer {
    accounts(filter: { accountTag: $account }) {
      vitals: rumWebVitalsEventsAdaptiveGroups(limit: 1, filter: {
        siteTag_in: $sites, datetime_geq: $start, datetime_lt: $end, bot: 0
      }) {
        count
        quantiles {
          largestContentfulPaintP75
          interactionToNextPaintP75
          cumulativeLayoutShiftP75
          firstContentfulPaintP75
          timeToFirstByteP75
        }
      }
    }
  }
}`;

// Web Analytics 的时长分位数单位是微秒；没有样本时返回 0，取不到时返回负数，两种都不当成真实数值。
function microsToMs(value: unknown): number | null {
  const micros = num(value);
  return micros > 0 ? Math.round(micros / 1000) : null;
}

export function parseFieldVitals(raw: unknown): FieldVitals {
  const body = record(raw);
  if (Array.isArray(body.errors) && body.errors.length) throw new Error("Web Analytics 查询失败");
  const accounts = record(record(body.data).viewer).accounts;
  if (!Array.isArray(accounts) || accounts.length !== 1) throw new Error("Web Analytics 账户不可用");
  const rows = record(accounts[0]).vitals;
  const row = Array.isArray(rows) ? record(rows[0]) : {};
  const samples = num(row.count);
  const q = record(row.quantiles);
  return {
    lcpP75Ms: microsToMs(q.largestContentfulPaintP75),
    inpP75Ms: microsToMs(q.interactionToNextPaintP75),
    clsP75: samples > 0 && typeof q.cumulativeLayoutShiftP75 === "number" && q.cumulativeLayoutShiftP75 >= 0 ? q.cumulativeLayoutShiftP75 : null,
    fcpP75Ms: microsToMs(q.firstContentfulPaintP75),
    ttfbP75Ms: microsToMs(q.timeToFirstByteP75),
    samples,
  };
}

export type CloudflareApi = (path: string, init?: { query?: Record<string, string>; body?: object }) => Promise<unknown>;

export function cloudflareApi(token: string, fetcher: typeof fetch = fetch): CloudflareApi {
  return async (path, init = {}) => {
    const url = new URL(`${API}${path}`);
    for (const [name, value] of Object.entries(init.query ?? {})) url.searchParams.set(name, value);
    const response = await fetcher(url, {
      method: init.body ? "POST" : "GET",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10_000),
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
    });
    if (!response.ok) throw new Error(`Cloudflare 查询失败 (${response.status} ${path})`);
    const body = await response.json() as Json;
    return path === "/graphql" ? body : body.result;
  };
}

async function errorCounts(api: CloudflareApi, account: string, from: number, to: number): Promise<Map<string, number>> {
  return parseErrorCounts(await api(`/accounts/${account}/workers/observability/telemetry/query`, {
    body: {
      queryId: "lyjwpage-health-errors",
      timeframe: { from, to },
      view: "calculations",
      chartType: "aggregate",
      ignoreSeries: true,
      limit: 100,
      parameters: {
        datasets: ["cloudflare-workers"],
        calculations: [{ operator: "count" }],
        filters: [
          { key: "$metadata.level", operation: "eq", type: "string", value: "error" },
          // 分支预览与生产同名同服务，只能靠 workers.dev 主机名分开；定时任务没有主机名，要留下。
          {
            kind: "group",
            filterCombination: "or",
            filters: [
              { key: "$workers.event.request.headers.host", operation: "is_null", type: "string" },
              { key: "$workers.event.request.headers.host", operation: "not_includes", type: "string", value: "workers.dev" },
            ],
          },
        ],
        groupBys: [{ type: "string", value: "$metadata.service" }],
      },
    },
  }));
}

// issue 摘要一个服务一次请求，逐个查：这一块和 Web Vitals 同时跑，collector 一次调用同时最多 6 个连接在等响应头。
async function activeIssues(api: CloudflareApi, account: string, services: readonly string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  for (const service of services) {
    const summary = await api(`/accounts/${account}/workers/observability/issues/summary`, { query: { service } });
    counts.set(service, num(record(summary).activeIssues));
  }
  return counts;
}

export async function fetchErrorSeries(api: CloudflareApi, account: string, now: number): Promise<{ site: ErrorSeries; worker: ErrorSeries }> {
  const [recent, week, issues] = await Promise.all([
    errorCounts(api, account, now - 12 * 3_600_000, now),
    errorCounts(api, account, now - 7 * 86_400_000, now),
    activeIssues(api, account, [...HEALTH_SITE_SERVICES, ...HEALTH_WORKER_SERVICES]),
  ]);
  const series = (services: readonly string[]): ErrorSeries => ({
    count12h: sumOf(recent, services),
    count7d: sumOf(week, services),
    unresolved: sumOf(issues, services),
  });
  return { site: series(HEALTH_SITE_SERVICES), worker: series(HEALTH_WORKER_SERVICES) };
}

export async function fetchFieldVitals(api: CloudflareApi, account: string, siteTags: readonly string[], now: number): Promise<FieldVitals> {
  return parseFieldVitals(await api("/graphql", {
    body: {
      query: VITALS_QUERY,
      variables: {
        account,
        sites: siteTags,
        start: new Date(now - 7 * 86_400_000).toISOString(),
        end: new Date(now).toISOString(),
      },
    },
  }));
}
