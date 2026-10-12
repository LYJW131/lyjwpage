import {
  consoleLoggingIntegration,
  httpServerIntegration,
  requestDataIntegration,
  type CloudflareOptions,
} from "@sentry/cloudflare";

import { commitSha } from "@/lib/build-info";
import { SENTRY_ENVIRONMENT } from "@shared/sentry";
import { isKnownLogNoise } from "@/lib/sentry-noise";
import { redactSentryEvent } from "@/lib/sentry-redact";

export function sentryOptions(env: Env): CloudflareOptions {
  return {
    dsn: env.SENTRY_DSN?.trim() || undefined,
    environment: SENTRY_ENVIRONMENT,
    release: commitSha ?? undefined,
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
