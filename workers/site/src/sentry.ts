import { consoleLoggingIntegration, type CloudflareOptions } from "@sentry/cloudflare";

import { commitSha } from "@/lib/build-info";
import { SENTRY_ENVIRONMENT } from "@shared/sentry";
import { isKnownLogNoise } from "@/lib/sentry-noise";
import { redactSentryEvent, redactSentrySpan, SENTRY_SITE_DATA_COLLECTION } from "@/lib/sentry-redact";

export function sentryOptions(env: Env): CloudflareOptions {
  return {
    dsn: env.SENTRY_DSN?.trim() || undefined,
    environment: SENTRY_ENVIRONMENT,
    release: commitSha ?? undefined,
    tracesSampleRate: 0.1,
    integrations: [
      consoleLoggingIntegration({ levels: ["warn", "error"] }),
    ],
    beforeSend: (event) => redactSentryEvent(event),
    beforeSendSpan: redactSentrySpan,
    beforeSendLog: (log) => (isKnownLogNoise(log.message) ? null : log),
    dataCollection: SENTRY_SITE_DATA_COLLECTION,
  };
}
