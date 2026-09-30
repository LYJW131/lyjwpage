import { consoleLoggingIntegration, type CloudflareOptions } from "@sentry/cloudflare";

import { previewWorkerEnabled, type Env } from "./env";

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
