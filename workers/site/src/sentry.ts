import {
  consoleLoggingIntegration,
  httpServerIntegration,
  requestDataIntegration,
  type CloudflareOptions,
} from "@sentry/cloudflare";

import { isKnownLogNoise } from "@/lib/sentry-noise";
import { redactSentryEvent } from "@/lib/sentry-redact";

export function sentryOptions(env: Env): CloudflareOptions {
  return {
    dsn: env.SENTRY_DSN?.trim() || undefined,
    environment: process.env.SENTRY_ENVIRONMENT || "development",
    release: process.env.COMMIT_SHA || undefined,
    tracesSampleRate: 0.1,
    enableLogs: true,
    integrations: [
      consoleLoggingIntegration({ levels: ["warn", "error"] }),
      httpServerIntegration({ maxRequestBodySize: "none" }),
      requestDataIntegration({ include: { cookies: false, data: false, headers: false } }),
    ],
    beforeSend: (event) => redactSentryEvent(event),
    beforeSendTransaction: (event) => redactSentryEvent(event),
    beforeSendLog: (log) => (isKnownLogNoise(log.message) ? null : log),
    sendDefaultPii: false,
  };
}
