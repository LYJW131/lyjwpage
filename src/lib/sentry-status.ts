import { SENTRY_STALE_MS } from "@/lib/freshness";
import { loadLag, type LagResult } from "@/lib/lag-result";
import {
  SENTRY_API_ORIGIN,
  SENTRY_COLLECTOR_PROJECT_ID,
  SENTRY_CRON_MONITOR_SLUG,
  SENTRY_ORG,
  SENTRY_SITE_PROJECT_ID,
  SENTRY_UPTIME_DETECTOR_ID,
  SENTRY_WORKER_PROJECT_ID,
} from "@/lib/sentry";
import type { HealthSeries, SentryBlock, SentryErrorSeries, SentryStatusPayload, SentryUptime, SentryVitals, UptimeDay } from "@/lib/sentry-status-types";
import { LAG_KEYS } from "@shared/lag";

/**
 * 站点卡片（LYJWPAGE）里在线率、api Worker 心跳、错误数和真实用户指标的数据。取数在
 * 采集 Worker（`sentry-status`，每 5 分钟），用 `SENTRY_API_TOKEN`（组织只读令牌，
 * org:read / project:read / event:read）调 Sentry API，写进可滞后层；公开端点只读那一份。
 *
 * 一轮十来个请求，分块各自降级：某一块失败沿用上一份的那一块（最多 30 分钟，见
 * mergeSentryStatus），不拖垮整张卡。访客的请求不直接打 Sentry。
 *
 * 心跳、错误、Vitals 都只算 production 环境：本地与分支预览的测试数据不进卡片。
 */

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
export function parseUptimeStatus(raw: unknown): HealthSeries["status"] {
  const status = record(raw).uptimeStatus;
  return status === 1 ? "up" : status === 2 ? "down" : "unknown";
}

/** cron 监控 `stats` 的一段 → 按桶计数。心跳缺席（missed）、超时、报错都是 Worker 这边的事，全算失败 */
export function parseCronBuckets(raw: unknown): UptimeDay[] {
  if (!Array.isArray(raw)) throw new Error("Sentry cron 统计格式无效");
  return raw.map((entry) => {
    const c = record(entry);
    return {
      dayStart: num(c.ts) * 1000,
      success: num(c.ok),
      failure: num(c.error) + num(c.missed) + num(c.timeout),
      missed: 0,
    };
  });
}

/** 监控详情里 production 环境的状态；这个环境还没报到过是 unknown */
export function parseCronStatus(raw: unknown): HealthSeries["status"] {
  const envs = record(raw).environments;
  const production = Array.isArray(envs) ? envs.map(record).find((env) => env.name === "production") : undefined;
  const status = production?.status;
  if (status === "ok") return "up";
  if (status === "error" || status === "missed_checkin" || status === "timeout") return "down";
  return "unknown";
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
const CRON_PATH = `${ORG_PATH}/monitors/${SENTRY_CRON_MONITOR_SLUG}`;

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

async function fetchHeartbeat(api: SentryGet, now: number): Promise<HealthSeries> {
  const seconds = (ms: number) => String(Math.floor(ms / 1000));
  const today = Math.floor(now / DAY_MS) * DAY_MS;
  const stats = (since: number, resolution: string) =>
    api(`${CRON_PATH}/stats/`, { since: seconds(since), until: seconds(now), resolution, environment: "production" });
  const [detail, daily, hourly] = await Promise.all([
    api(`${CRON_PATH}/`, {}).catch(() => null),
    stats(today - (UPTIME_DAYS - 1) * DAY_MS, "1d"),
    stats(now - DAY_MS, "1h"),
  ]);
  const days = parseCronBuckets(daily);
  return {
    status: parseCronStatus(detail),
    availability24h: availability(parseCronBuckets(hourly)),
    availability30d: availability(days),
    days,
  };
}

/** 多个项目时 Sentry 按 `project` 重复参数合起来算，计数就是几个项目之和 */
async function fetchErrors(api: SentryGet, project: string | string[]): Promise<SentryErrorSeries> {
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
  const [uptime, heartbeat, site, worker, vitals] = await Promise.all([
    settle(fetchUptime(api, now)),
    settle(fetchHeartbeat(api, now)),
    settle(fetchErrors(api, SENTRY_SITE_PROJECT_ID)),
    // 「API」那一行是整个后端：api Worker 和采集 Worker 两个项目合计
    settle(fetchErrors(api, [SENTRY_WORKER_PROJECT_ID, SENTRY_COLLECTOR_PROJECT_ID])),
    settle(fetchVitals(api)),
  ]);
  if (!uptime && !heartbeat && !site && !worker && !vitals) throw new Error("Sentry 全部查询失败");
  return {
    fetchedAt: now,
    uptime,
    heartbeat,
    errors: site && worker ? { site, worker } : null,
    vitals,
  };
}

/** 块级沿用最多撑这么久，和卡片判 Sentry 那一格过期的阈值是同一个；再旧就当这一块没有 */
export const SENTRY_BLOCK_CARRY_MS = SENTRY_STALE_MS;

/**
 * 这一轮没取到的块沿用上一份（带着上一份自己的数和取到时刻），取到的用新的。
 * 采集 Worker 写可滞后层时用：块级降级，而不是整张卡回到上一轮。沿用的块超过
 * SENTRY_BLOCK_CARRY_MS 就不再沿用，那一格回到「没有」，不拿旧数冒充新的。
 */
export function mergeSentryStatus(next: SentryStatusPayload, previous: SentryStatusPayload | null): SentryStatusPayload {
  const blockAt: Partial<Record<SentryBlock, number>> = {};
  const carry = <K extends SentryBlock>(block: K): SentryStatusPayload[K] => {
    if (next[block] != null) {
      blockAt[block] = next.fetchedAt;
      return next[block];
    }
    const at = previous?.blockAt?.[block] ?? previous?.fetchedAt;
    if (previous?.[block] == null || at == null || next.fetchedAt - at >= SENTRY_BLOCK_CARRY_MS) return null as SentryStatusPayload[K];
    blockAt[block] = at;
    return previous[block];
  };
  return {
    fetchedAt: next.fetchedAt,
    uptime: carry("uptime"),
    heartbeat: carry("heartbeat"),
    errors: carry("errors"),
    vitals: carry("vitals"),
    blockAt,
  };
}

/** 公开端点：可滞后层里采集 Worker 写的那份；还没写过就是等采集 */
export function getSentryStatus(): Promise<LagResult<SentryStatusPayload>> {
  return loadLag<SentryStatusPayload>(LAG_KEYS.sentry, "Waiting for the first Sentry check");
}
