import * as Sentry from "@sentry/cloudflare";
import { consoleLoggingIntegration, type CloudflareOptions } from "@sentry/cloudflare";

import type { Env } from "./env";

export function sentryOptions(env: Env): CloudflareOptions {
  return {
    dsn: env.SENTRY_DSN?.trim() || undefined,
    environment: env.SENTRY_ENVIRONMENT?.trim() || "production",
    tracesSampleRate: 0.01,
    enableLogs: true,
    integrations: [consoleLoggingIntegration({ levels: ["warn", "error"] })],
    sendDefaultPii: false,
  };
}

const REPORT_EVERY_MS = 15 * 60_000;
const reportedAt = new Map<string, number>();

export function reportJobFailure(job: string, error: Error): void {
  const now = Date.now();
  if (now - (reportedAt.get(job) ?? 0) < REPORT_EVERY_MS) return;
  reportedAt.set(job, now);
  Sentry.withScope((scope) => {
    scope.setTag("collector.job", job);
    scope.setFingerprint(["collector-job", job]);
    Sentry.captureException(error);
  });
}
