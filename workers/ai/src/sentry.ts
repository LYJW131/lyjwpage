import {
  consoleLoggingIntegration,
  httpServerIntegration,
  requestDataIntegration,
  type CloudflareOptions,
} from "@sentry/cloudflare";

import { previewWorkerEnabled } from "./runtime";
import type { Env } from "./runtime";

export function sentryOptions(env: Env): CloudflareOptions {
  return {
    dsn: env.SENTRY_DSN?.trim() || undefined,
    environment: env.SENTRY_ENVIRONMENT?.trim() || (previewWorkerEnabled(env) ? "preview" : "production"),
    tracesSampleRate: 0.01,
    enableLogs: true,
    initialScope: { tags: { worker: "ai" } },
    // 关掉正文与请求头采集，原因见 workers/api/src/sentry.ts#sentryOptions。
    integrations: [
      consoleLoggingIntegration({ levels: ["warn", "error"] }),
      httpServerIntegration({ maxRequestBodySize: "none" }),
      requestDataIntegration({ include: { cookies: false, data: false, headers: false } }),
    ],
    sendDefaultPii: false,
  };
}
