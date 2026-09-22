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
