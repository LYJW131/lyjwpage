import { cached, get, put } from "@/lib/cache";
import {
  SENTRY_API_ORIGIN,
  SENTRY_ORG,
  SENTRY_SITE_PROJECT_ID,
  SENTRY_UPTIME_DETECTOR_ID,
  SENTRY_WORKER_PROJECT_ID,
} from "@/lib/sentry";
import type { SentryErrorSeries, SentryStatusPayload, SentryUptime, SentryVitals, UptimeDay } from "@/lib/sentry-status-types";

/**
 * 站点卡片（LYJWPAGE）里在线率、错误数和真实用户指标的数据：只在 API Worker 里跑，用 `SENTRY_API_TOKEN`（组织只读令牌，
 * org:read / project:read / event:read）调 Sentry API。
 *
 * 一轮十来个请求，分块各自降级：某一块失败只让那一块为 null，不拖垮整张卡。
 * 结果缓存 5 分钟，另留一份 last-good 撑过 Sentry 短暂不可用。这条视图是慢端点
 * （进 KV 投影），分钟 cron 顺带重渲染，访客的请求不直接打 Sentry。
 *
 * 错误、Vitals 都只算 production 环境：本地与分支预览的测试数据不进卡片。
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

/** 探测器详情里的 uptimeStatus：1 正常、2 失败 */
export function parseUptimeStatus(raw: unknown): SentryUptime["status"] {
  const status = record(raw).uptimeStatus;
  return status === 1 ? "up" : status === 2 ? "down" : "unknown";
}

/** Discover 的单行聚合 → 第一行的字段 */
export function parseAggregateRow(raw: unknown): Json {
  const data = record(raw).data;
  return Array.isArray(data) ? record(data[0]) : {};
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
  const [detail, daily, hourly] = await Promise.all([
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
  ]);
  const info = record(detail);
  const days = parseUptimeBuckets(daily, SENTRY_UPTIME_DETECTOR_ID);
  return {
    status: parseUptimeStatus(detail),
    url: typeof info.url === "string" ? info.url : "",
    intervalSeconds: num(info.intervalSeconds) || 60,
    availability24h: availability(parseUptimeBuckets(hourly, SENTRY_UPTIME_DETECTOR_ID)),
    availability30d: availability(days),
    days,
  };
}

async function fetchErrors(api: SentryGet, project: string): Promise<SentryErrorSeries> {
  const env = { project, environment: "production" };
  const [recent, week, unresolved] = await Promise.all([
    api(`${ORG_PATH}/events/`, { ...env, dataset: "errors", field: "count()", statsPeriod: "12h" }),
    api(`${ORG_PATH}/events/`, { ...env, dataset: "errors", field: "count()", statsPeriod: "7d" }),
    api(`${ORG_PATH}/issues-count/`, { ...env, query: "is:unresolved" }),
  ]);
  return {
    count12h: num(parseAggregateRow(recent)["count()"]),
    count7d: num(parseAggregateRow(week)["count()"]),
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
  const [uptime, site, worker, vitals] = await Promise.all([
    settle(fetchUptime(api, now)),
    settle(fetchErrors(api, SENTRY_SITE_PROJECT_ID)),
    settle(fetchErrors(api, SENTRY_WORKER_PROJECT_ID)),
    settle(fetchVitals(api)),
  ]);
  if (!uptime && !site && !worker && !vitals) throw new Error("Sentry 全部查询失败");
  return {
    fetchedAt: now,
    uptime,
    errors: site && worker ? { site, worker } : null,
    vitals,
  };
}

export async function getSentryStatus(): Promise<SentryStatusPayload> {
  const token = process.env.SENTRY_API_TOKEN?.trim();
  if (!token) throw new Error("Sentry 读取未配置");
  // v6：在线率带上探测器此刻的状态（v5 加回在线率，v4 去掉会话与 cron 心跳）
  const key = `sentry-status:v6:${SENTRY_ORG}`;
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
