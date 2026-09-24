import { consoleLoggingIntegration, type CloudflareOptions } from "@sentry/cloudflare";

import { previewWorkerEnabled } from "./preview";
import type { Env } from "./runtime";

/**
 * Sentry 的 Worker 侧配置，普通请求、cron、两个 Durable Object 和 ReadModelRenderer 共用。
 *
 * DSN 只配在 wrangler.toml 的 `[vars]` / `[previews.vars]`：本地 `wrangler.test.toml`
 * 不配，`pnpm dev:worker` 就不往 Sentry 报；本地要试就 `--var SENTRY_DSN:… --var
 * SENTRY_ENVIRONMENT:development`，别混进 production。DSN 本来就是公开的写入地址，不算秘密。
 * release 由 SDK 从 `CF_VERSION_METADATA` 取版本 ID，和 Workers 控制台的部署记录对得上。
 *
 * 免费档一个月 5M span：每分钟一趟的 cron 带着几十个外部 fetch，SWR 轮询也打这里，
 * 采样只留 1%，够看慢在哪一段，不够拿来算总量。日志只收 warn / error —— 现有的
 * `console.warn("[pulse-score]", …)` 这类降级提示原样进 Sentry Logs，不用改调用点。
 */
export function sentryOptions(env: Env): CloudflareOptions {
  return {
    dsn: env.SENTRY_DSN?.trim() || undefined,
    environment: env.SENTRY_ENVIRONMENT?.trim() || (previewWorkerEnabled() ? "preview" : "production"),
    tracesSampleRate: 0.01,
    enableLogs: true,
    integrations: [consoleLoggingIntegration({ levels: ["warn", "error"] })],
    sendDefaultPii: false,
  };
}
