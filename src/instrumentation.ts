import * as Sentry from "@sentry/nextjs";

/**
 * 服务端监控入口。开了 cacheComponents 后不能导出 `runtime`，全站都跑在 Node.js，
 * 这里也只接 Node.js 一种。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") await import("./sentry.server.config");
}

export const onRequestError = Sentry.captureRequestError;
