import * as Sentry from "@sentry/cloudflare";
import {
  consoleLoggingIntegration,
  httpServerIntegration,
  requestDataIntegration,
  type CloudflareOptions,
} from "@sentry/cloudflare";

import type { Env } from "./env";

export function sentryOptions(env: Env): CloudflareOptions {
  return {
    dsn: env.SENTRY_DSN?.trim() || undefined,
    environment: env.SENTRY_ENVIRONMENT?.trim() || "production",
    tracesSampleRate: 0.01,
    enableLogs: true,
    // 关掉正文与请求头采集，原因见 workers/api/src/sentry.ts#sentryOptions。
    integrations: [
      consoleLoggingIntegration({ levels: ["warn", "error"] }),
      httpServerIntegration({ maxRequestBodySize: "none" }),
      requestDataIntegration({ include: { cookies: false, data: false, headers: false } }),
    ],
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
