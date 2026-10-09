import {
  consoleLoggingIntegration,
  httpServerIntegration,
  requestDataIntegration,
  type CloudflareOptions,
} from "@sentry/cloudflare";

import { previewWorkerEnabled } from "./preview";
import type { Env } from "./runtime";

export function sentryOptions(env: Env): CloudflareOptions {
  return {
    dsn: env.SENTRY_DSN?.trim() || undefined,
    environment: env.SENTRY_ENVIRONMENT?.trim() || (previewWorkerEnabled() ? "preview" : "production"),
    tracesSampleRate: 0.01,
    enableLogs: true,
    // 默认的 HttpServer 集成不看 sendDefaultPii 就读 POST 正文，RequestData 再把正文和请求头原样写进 event.request
    // （整段对话、OAuth code、出站代理请求带的 x-api-key）；同名集成覆盖默认实例。别改用 dataCollection：没写的项按全开补齐。
    integrations: [
      consoleLoggingIntegration({ levels: ["warn", "error"] }),
      httpServerIntegration({ maxRequestBodySize: "none" }),
      requestDataIntegration({ include: { cookies: false, data: false, headers: false } }),
    ],
    sendDefaultPii: false,
  };
}
