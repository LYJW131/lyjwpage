import { consoleLoggingIntegration, type CloudflareOptions } from "@sentry/cloudflare";

import type { Env } from "./env";

/**
 * 采集 Worker 的 Sentry 配置（项目 `collector-worker`）：cron、`Collector` RPC 共用。
 *
 * DSN 只配在 wrangler.toml 的 `[vars]`：本地 wrangler.test.toml 不配，本地就不上报。
 * release 由 SDK 从 `CF_VERSION_METADATA` 取版本 ID。日志只收 warn / error ——
 * 缺令牌跳过、上游不可用这类提示原样进 Sentry Logs。
 */
export function sentryOptions(env: Env): CloudflareOptions {
  return {
    dsn: env.SENTRY_DSN?.trim() || undefined,
    environment: env.SENTRY_ENVIRONMENT?.trim() || "production",
    tracesSampleRate: 0.01,
    enableLogs: true,
    integrations: [consoleLoggingIntegration({ levels: ["warn", "error"] })],
    sendDefaultPii: false,
  };
}
