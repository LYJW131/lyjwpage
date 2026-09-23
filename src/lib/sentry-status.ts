import { cached, get, put } from "@/lib/cache";
import {
  SENTRY_API_ORIGIN,
  SENTRY_CRON_MONITOR_SLUG,
  SENTRY_ORG,
  SENTRY_SITE_PROJECT_ID,
  SENTRY_UPTIME_DETECTOR_ID,
  SENTRY_WORKER_PROJECT_ID,
} from "@/lib/sentry";
import type { SentryErrorSeries, SentryStatusPayload, SentryUptime, SentryVitals, UptimeDay } from "@/lib/sentry-status-types";

/**
 * 站点卡片（LYJWPAGE）里在线率、错误数、真实用户指标和 cron 心跳的数据：只在 API Worker 里跑，用 `SENTRY_API_TOKEN`（组织只读令牌，
 * org:read / project:read / event:read）调 Sentry API。
 *
 * 一轮十来个请求，分块各自降级：某一块失败只让那一块为 null，不拖垮整张卡。
 * 结果缓存 5 分钟，另留一份 last-good 撑过 Sentry 短暂不可用。这条视图是慢端点
 * （进 KV 投影），分钟 cron 顺带重渲染，访客的请求不直接打 Sentry。
 *
 * 错误、会话、Vitals 都只算 production 环境：本地与分支预览的测试数据不进卡片。
 */

const CACHE_TTL_MS = 5 * 60_000;
const LAST_GOOD_TTL_MS = 24 * 60 * 60_000;
const DAY_MS = 24 * 60 * 60_000;
const UPTIME_DAYS = 30;

type Json = Record<string, unknown>;

function record(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function numOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isoToMs(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** 成功 / (成功 + 失败)；missed 是探测自己没跑成，不算站点的账 */
export function availability(days: Pick<UptimeDay, "success" | "failure">[]): number | null {
  const success = days.reduce((sum, day) => sum + day.success, 0);
  const failure = days.reduce((sum, day) => sum + day.failure, 0);
  return success + failure > 0 ? success / (success + failure) : null;
}

/** `uptime-stats` 的一个探测器序列 → 按桶计数；`failure_incident` 是事故期间的失败，同样算宕机 */
export function parseUptimeBuckets(raw: unknown, detectorId: string): UptimeDay[] {
  const series = record(raw)[detectorId];
  if (!Array.isArray(series)) throw new Error("Sentry 在线统计格式无效");
  return series.map((entry) => {
    const [seconds, counts] = Array.isArray(entry) ? entry : [];
    const c = record(counts);
    return {
      dayStart: num(seconds) * 1000,
      success: num(c.success),
      failure: num(c.failure) + num(c.failure_incident),
      missed: num(c.missed_window),
    };
  });
}

/** 探测器详情里的 uptimeStatus：1 正常、2 失败（连续失败到阈值才翻） */
export function parseUptimeStatus(raw: unknown): { status: SentryUptime["status"]; url: string; intervalSeconds: number } {
  const detail = record(raw);
  const status = detail.uptimeStatus === 1 ? "up" : detail.uptimeStatus === 2 ? "down" : "unknown";
  return {
    status,
    url: typeof detail.url === "string" ? detail.url : "",
    intervalSeconds: num(detail.intervalSeconds) || 60,
  };
}

export function parseLastCheck(raw: unknown): SentryUptime["lastCheck"] {
  const first = Array.isArray(raw) ? record(raw[0]) : {};
  const at = isoToMs(first.timestamp);
  if (at == null) return null;
  return { at, durationMs: numOrNull(first.durationMs), httpStatus: numOrNull(first.httpStatusCode) };
}

/** `events-stats` 单序列 → 逐桶计数，旧的在前 */
export function parseEventCounts(raw: unknown): number[] {
  const data = record(raw).data;
  if (!Array.isArray(data)) throw new Error("Sentry 事件统计格式无效");
  return data.map((entry) => {
    const values = Array.isArray(entry) ? entry[1] : null;
    return Array.isArray(values) ? values.reduce((sum: number, value) => sum + num(record(value).count), 0) : 0;
  });
}

/** Discover 的单行聚合 → 第一行的字段 */
export function parseAggregateRow(raw: unknown): Json {
  const data = record(raw).data;
  return Array.isArray(data) ? record(data[0]) : {};
}

export function parseSessions(raw: unknown): SentryStatusPayload["sessions"] {
  const groups = record(raw).groups;
  const totals = Array.isArray(groups) ? record(record(groups[0]).totals) : {};
  const count = num(totals["sum(session)"]);
  return { crashFreeRate: count > 0 ? numOrNull(totals["crash_free_rate(session)"]) : null, count };
}

const CRON_STATUSES = { ok: "ok", error: "error", missed_checkin: "missed", timeout: "timeout" } as const;

/** 只看 production 那一格；还没报到过（刚上线或只有本地测试）是 unknown */
export function parseCron(raw: unknown): SentryStatusPayload["cron"] {
  const environments = record(raw).environments;
  const production = Array.isArray(environments)
    ? environments.map(record).find((env) => env.name === "production")
    : undefined;
  if (!production) return { status: "unknown", lastCheckInAt: null };
  const status = CRON_STATUSES[production.status as keyof typeof CRON_STATUSES] ?? "unknown";
  return { status, lastCheckInAt: isoToMs(production.lastCheckIn) };
}

/** path 从 `/api/0` 之后写起；组织级接口用 ORG_PATH 开头 */
export type SentryGet = (path: string, params: Record<string, string | string[]>) => Promise<unknown>;

const ORG_PATH = `/organizations/${SENTRY_ORG}`;
/** 在线监测挂在站点项目下 */
const UPTIME_PATH = `/projects/${SENTRY_ORG}/lyjwpage/uptime/${SENTRY_UPTIME_DETECTOR_ID}`;

export function sentryClient(token: string): SentryGet {
  return async (path, params) => {
    const url = new URL(`/api/0${path}`, SENTRY_API_ORIGIN);
    for (const [name, value] of Object.entries(params)) {
      for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(name, item);
    }
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, "User-Agent": "lyjwpage-sentry-status" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Sentry 查询失败 (${response.status} ${path})`);
    return response.json();
  };
}

async function fetchUptime(api: SentryGet, now: number): Promise<SentryUptime> {
  const seconds = (ms: number) => String(Math.floor(ms / 1000));
  const today = Math.floor(now / DAY_MS) * DAY_MS;
  const [detail, daily, hourly, checks] = await Promise.all([
    api(`${UPTIME_PATH}/`, {}).catch(() => null),
    api(`${ORG_PATH}/uptime-stats/`, {
      uptimeDetectorId: SENTRY_UPTIME_DETECTOR_ID,
      since: seconds(today - (UPTIME_DAYS - 1) * DAY_MS),
      until: seconds(now),
      resolution: "1d",
    }),
    api(`${ORG_PATH}/uptime-stats/`, {
      uptimeDetectorId: SENTRY_UPTIME_DETECTOR_ID,
      since: seconds(now - DAY_MS),
      until: seconds(now),
      resolution: "1h",
    }),
    api(`${UPTIME_PATH}/checks/`, { per_page: "1" }).catch(() => null),
  ]);
  const days = parseUptimeBuckets(daily, SENTRY_UPTIME_DETECTOR_ID);
  return {
    ...parseUptimeStatus(detail),
    availability24h: availability(parseUptimeBuckets(hourly, SENTRY_UPTIME_DETECTOR_ID)),
    availability30d: availability(days),
    days,
    lastCheck: parseLastCheck(checks),
  };
}

async function fetchErrors(api: SentryGet, project: string): Promise<SentryErrorSeries> {
  const env = { project, environment: "production" };
  const [hourly, day, week, unresolved] = await Promise.all([
    api(`${ORG_PATH}/events-stats/`, { ...env, dataset: "errors", yAxis: "count()", interval: "1h", statsPeriod: "24h" }),
    api(`${ORG_PATH}/events/`, { ...env, dataset: "errors", field: "count()", statsPeriod: "24h" }),
    api(`${ORG_PATH}/events/`, { ...env, dataset: "errors", field: "count()", statsPeriod: "7d" }),
    api(`${ORG_PATH}/issues-count/`, { ...env, query: "is:unresolved" }),
  ]);
  return {
    count24h: num(parseAggregateRow(day)["count()"]),
    count7d: num(parseAggregateRow(week)["count()"]),
    hourly: parseEventCounts(hourly).slice(-24),
    unresolved: num(record(unresolved)["is:unresolved"]),
  };
}

const INTERACTION_OPS = "[ui.interaction.click,ui.interaction.press,ui.interaction.hover,ui.interaction.drag]";

async function fetchVitals(api: SentryGet): Promise<SentryVitals> {
  const env = { project: SENTRY_SITE_PROJECT_ID, environment: "production", dataset: "spans", statsPeriod: "7d" };
  const [pageload, interaction] = await Promise.all([
    api(`${ORG_PATH}/events/`, {
      ...env,
      query: "span.op:pageload",
      field: ["p75(measurements.lcp)", "p75(measurements.cls)", "p75(measurements.fcp)", "p75(measurements.ttfb)", "count()"],
    }),
    api(`${ORG_PATH}/events/`, { ...env, query: `span.op:${INTERACTION_OPS}`, field: ["p75(measurements.inp)"] }),
  ]);
  const row = parseAggregateRow(pageload);
  return {
    lcpP75Ms: numOrNull(row["p75(measurements.lcp)"]),
    inpP75Ms: numOrNull(parseAggregateRow(interaction)["p75(measurements.inp)"]),
    clsP75: numOrNull(row["p75(measurements.cls)"]),
    fcpP75Ms: numOrNull(row["p75(measurements.fcp)"]),
    ttfbP75Ms: numOrNull(row["p75(measurements.ttfb)"]),
    samples: num(row["count()"]),
  };
}

/** 各块并行、各自降级；只有全部失败才算这一轮失败，交给 last-good */
export async function fetchSentryStatus(api: SentryGet, now = Date.now()): Promise<SentryStatusPayload> {
  const settle = <T>(promise: Promise<T>) => promise.catch((error: unknown) => {
    console.warn("[sentry-status]", error instanceof Error ? error.message : String(error));
    return null;
  });
  const [uptime, site, worker, sessions, cron, vitals] = await Promise.all([
    settle(fetchUptime(api, now)),
    settle(fetchErrors(api, SENTRY_SITE_PROJECT_ID)),
    settle(fetchErrors(api, SENTRY_WORKER_PROJECT_ID)),
    settle(api(`${ORG_PATH}/sessions/`, {
      project: SENTRY_SITE_PROJECT_ID,
      environment: "production",
      field: ["crash_free_rate(session)", "sum(session)"],
      statsPeriod: "24h",
      interval: "1d",
    }).then(parseSessions)),
    settle(api(`${ORG_PATH}/monitors/${SENTRY_CRON_MONITOR_SLUG}/`, {}).then(parseCron)),
    settle(fetchVitals(api)),
  ]);
  if (!uptime && !site && !worker && !sessions && !cron && !vitals) throw new Error("Sentry 全部查询失败");
  return {
    fetchedAt: now,
    uptime,
    errors: site && worker ? { site, worker } : null,
    sessions,
    cron,
    vitals,
  };
}

export async function getSentryStatus(): Promise<SentryStatusPayload> {
  const token = process.env.SENTRY_API_TOKEN?.trim();
  if (!token) throw new Error("Sentry 读取未配置");
  const key = `sentry-status:v1:${SENTRY_ORG}`;
  return cached<SentryStatusPayload>(key, CACHE_TTL_MS, async () => {
    try {
      const data = await fetchSentryStatus(sentryClient(token));
      await put(`${key}:last-good`, data, LAST_GOOD_TTL_MS);
      return data;
    } catch (error) {
      console.warn("[sentry-status]", error instanceof Error ? error.message : String(error));
      const previous = await get<SentryStatusPayload>(`${key}:last-good`);
      if (previous) return previous;
      throw new Error("Sentry 状态暂不可用");
    }
  });
}
