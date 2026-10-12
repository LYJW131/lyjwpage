import { consoleLoggingIntegration, type CloudflareOptions } from "@sentry/cloudflare";

import { previewWorkerEnabled } from "./runtime";
import type { Env } from "./runtime";

export function sentryOptions(env: Env): CloudflareOptions {
  return {
    dsn: env.SENTRY_DSN?.trim() || undefined,
    environment: env.SENTRY_ENVIRONMENT?.trim() || (previewWorkerEnabled(env) ? "preview" : "production"),
    tracesSampleRate: 0.01,
    initialScope: { tags: { worker: "ai" }, attributes: { worker: "ai" } },
    integrations: [
      consoleLoggingIntegration({ levels: ["warn", "error"] }),
    ],
    // 每项都显式关掉，原因见 workers/api/src/sentry.ts#sentryOptions。
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
