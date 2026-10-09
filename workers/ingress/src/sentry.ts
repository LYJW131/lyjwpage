import {
  consoleLoggingIntegration,
  httpServerIntegration,
  requestDataIntegration,
  type CloudflareOptions,
} from "@sentry/cloudflare";

import { previewWorkerEnabled, type Env } from "./env";

export function sentryOptions(env: Env): CloudflareOptions {
  return {
    dsn: env.SENTRY_DSN?.trim() || undefined,
    environment: env.SENTRY_ENVIRONMENT?.trim() || (previewWorkerEnabled() ? "preview" : "production"),
    tracesSampleRate: 0.01,
    enableLogs: true,
    // 关掉正文与请求头采集，原因见 workers/api/src/sentry.ts#sentryOptions。
    integrations: [
      consoleLoggingIntegration({ levels: ["warn", "error"] }),
      httpServerIntegration({ maxRequestBodySize: "none" }),
      requestDataIntegration({ include: { cookies: false, data: false, headers: false } }),
    ],
    sendDefaultPii: false,
    initialScope: { tags: { worker: "ingress" } },
  };
}
