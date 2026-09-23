import { cached, get, put } from "@/lib/cache";
import {
  SENTRY_API_ORIGIN,
  SENTRY_ORG,
  SENTRY_SITE_PROJECT_ID,
  SENTRY_WORKER_PROJECT_ID,
} from "@/lib/sentry";
import type { SentryErrorSeries, SentryStatusPayload, SentryVitals } from "@/lib/sentry-status-types";

/**
 * 站点卡片（LYJWPAGE）里错误数和真实用户指标的数据：只在 API Worker 里跑，用 `SENTRY_API_TOKEN`（组织只读令牌，
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

/** Discover 的单行聚合 → 第一行的字段 */
export function parseAggregateRow(raw: unknown): Json {
  const data = record(raw).data;
  return Array.isArray(data) ? record(data[0]) : {};
}

/** path 从 `/api/0` 之后写起；组织级接口用 ORG_PATH 开头 */
export type SentryGet = (path: string, params: Record<string, string | string[]>) => Promise<unknown>;

const ORG_PATH = `/organizations/${SENTRY_ORG}`;

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
  const [site, worker, vitals] = await Promise.all([
    settle(fetchErrors(api, SENTRY_SITE_PROJECT_ID)),
    settle(fetchErrors(api, SENTRY_WORKER_PROJECT_ID)),
    settle(fetchVitals(api)),
  ]);
  if (!site && !worker && !vitals) throw new Error("Sentry 全部查询失败");
  return {
    fetchedAt: now,
    errors: site && worker ? { site, worker } : null,
    vitals,
  };
}

export async function getSentryStatus(): Promise<SentryStatusPayload> {
  const token = process.env.SENTRY_API_TOKEN?.trim();
  if (!token) throw new Error("Sentry 读取未配置");
  // v4：去掉会话与 cron 心跳（站点卡片不再展示，监控本身留在 Sentry 里报警）
  const key = `sentry-status:v4:${SENTRY_ORG}`;
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
