import { consoleLoggingIntegration, type CloudflareOptions } from "@sentry/cloudflare";

import { previewWorkerEnabled, type Env } from "./env";

/**
 * 上报入口的 Sentry 配置。和状态核心共用 `api-worker` 项目（同一个 DSN），
 * 每个事件带 `worker: ingress` 标签区分：排查上报时按 `worker:ingress` 过滤。
 *
 * DSN 只配在 wrangler.toml 的 `[vars]`：本地 wrangler.test.toml 不配，本地就不上报。
 * release 由 SDK 从 `CF_VERSION_METADATA` 取版本 ID。日志只收 warn / error ——
 * `[ingest]` 拒收、`[auth]` 越权这类提示原样进 Sentry Logs。
 */
export function sentryOptions(env: Env): CloudflareOptions {
  return {
    dsn: env.SENTRY_DSN?.trim() || undefined,
    environment: env.SENTRY_ENVIRONMENT?.trim() || (previewWorkerEnabled() ? "preview" : "production"),
    tracesSampleRate: 0.01,
    enableLogs: true,
    integrations: [consoleLoggingIntegration({ levels: ["warn", "error"] })],
    sendDefaultPii: false,
    initialScope: { tags: { worker: "ingress" } },
  };
}
