import * as Sentry from "@sentry/cloudflare";
import { consoleLoggingIntegration, type CloudflareOptions } from "@sentry/cloudflare";

import type { Env } from "./env";

export function sentryOptions(env: Env): CloudflareOptions {
  return {
    dsn: env.SENTRY_DSN?.trim() || undefined,
    environment: env.SENTRY_ENVIRONMENT?.trim() || "production",
    tracesSampleRate: 0.01,
    integrations: [
      consoleLoggingIntegration({ levels: ["warn", "error"] }),
    ],
    // 每项都显式关掉，原因见 workers/core/src/sentry.ts#sentryOptions。
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
