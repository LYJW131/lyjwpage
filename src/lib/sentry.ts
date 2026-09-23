/**
 * 站点 Sentry 的共用常量：浏览器（src/instrumentation-client.ts）和服务端
 * （src/sentry.server.config.ts）各初始化一次，都从这里取。
 *
 * DSN 是公开的写入地址，本来就会出现在浏览器包里，直接写死，Vercel 不用配变量。
 * environment 由 next.config 在构建期按 VERCEL_ENV 焊进来：production / preview；
 * 本地是 development，默认不上报，要在本地看效果时设 NEXT_PUBLIC_SENTRY_DEV=true。
 */
export const SENTRY_DSN =
  "https://13d4c7b65d377b6a3e1e546f9d940b9d@o4511888459890688.ingest.us.sentry.io/4512132602331136";

export const SENTRY_ENVIRONMENT = process.env.SENTRY_ENVIRONMENT || "development";

export const SENTRY_ENABLED =
  SENTRY_ENVIRONMENT !== "development" || process.env.NEXT_PUBLIC_SENTRY_DEV === "true";

/**
 * 组织与项目的标识，都不是秘密。站点卡片取数（lib/sentry-status）和 Worker 的
 * cron 心跳（workers/api/src/sentry.ts）共用，改名要两边一起动。
 */
export const SENTRY_ORG = "yangjunwei-liang";
/** 组织落在美区，带令牌的 API 请求要打到这个区域域名 */
export const SENTRY_API_ORIGIN = "https://us.sentry.io";
export const SENTRY_SITE_PROJECT_ID = "4512132602331136";
export const SENTRY_WORKER_PROJECT_ID = "4512132602855424";
export const SENTRY_CRON_MONITOR_SLUG = "api-minute-cron";
