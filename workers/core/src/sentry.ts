import { consoleLoggingIntegration, type CloudflareOptions } from "@sentry/cloudflare";

import { previewWorkerEnabled } from "./preview";
import type { Env } from "./runtime";

export function sentryOptions(env: Env): CloudflareOptions {
  return {
    dsn: env.SENTRY_DSN?.trim() || undefined,
    environment: env.SENTRY_ENVIRONMENT?.trim() || (previewWorkerEnabled() ? "preview" : "production"),
    tracesSampleRate: 0.01,
    integrations: [
      consoleLoggingIntegration({ levels: ["warn", "error"] }),
    ],
    // 请求正文与请求头里有整段对话、OAuth code 和出站代理带的 x-api-key。dataCollection 没写的项按全开补齐
    // （IP、请求头、全部正文），所以每项都显式关掉。
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      graphQL: { document: false, variables: false },
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    },
  };
}
