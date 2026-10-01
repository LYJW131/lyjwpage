import { consoleLoggingIntegration, type CloudflareOptions } from "@sentry/cloudflare";

import { previewWorkerEnabled } from "./preview";
import type { Env } from "./runtime";
import { enrichDurableObjectEvent, type DurableObjectClass } from "./durable-object-diagnostics";
import { buildCommit } from "@api/build-metadata";

export function sentryOptions(env: Env, className?: DurableObjectClass): CloudflareOptions {
  return {
    dsn: env.SENTRY_DSN?.trim() || undefined,
    environment: env.SENTRY_ENVIRONMENT?.trim() || (previewWorkerEnabled() ? "preview" : "production"),
    tracesSampleRate: 0.01,
    enableLogs: true,
    integrations: [consoleLoggingIntegration({ levels: ["warn", "error"] })],
    sendDefaultPii: false,
    initialScope: {
      tags: { worker: "api", ...(buildCommit ? { "deployment.commit": buildCommit } : {}) },
      attributes: {
        worker: "api",
        ...(env.CF_VERSION_METADATA?.id ? { "deployment.version": env.CF_VERSION_METADATA.id } : {}),
        ...(buildCommit ? { "deployment.commit": buildCommit } : {}),
      },
      contexts: {
        deployment: {
          ...(env.CF_VERSION_METADATA?.id ? { version_id: env.CF_VERSION_METADATA.id } : {}),
          ...(buildCommit ? { commit_sha: buildCommit } : {}),
        },
      },
    },
    beforeSend: (event, hint) => enrichDurableObjectEvent(event, hint.originalException, className),
  };
}
