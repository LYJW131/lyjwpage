import * as Sentry from "@sentry/react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

import { commitSha } from "@/lib/build-info";
import {
  SENTRY_DSN,
  SENTRY_ENABLED,
  SENTRY_ENVIRONMENT,
  SENTRY_RELAY_PREFIX,
} from "@shared/sentry";
import { redactSentryEvent, redactSentrySpan, SENTRY_SITE_DATA_COLLECTION } from "@/lib/sentry-redact";

Sentry.init({
  dsn: SENTRY_DSN,
  enabled: SENTRY_ENABLED,
  environment: SENTRY_ENVIRONMENT,
  release: commitSha ?? undefined,
  tunnel: SENTRY_RELAY_PREFIX,
  tracesSampleRate: 0.1,
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] }),
  ],
  beforeSend: (event) => redactSentryEvent(event),
  beforeSendSpan: redactSentrySpan,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1,
  dataCollection: SENTRY_SITE_DATA_COLLECTION,
});

if (SENTRY_ENABLED) {
  const loadReplay = () => {
    import("@/lib/sentry-replay").then(({ attachReplay }) => attachReplay()).catch(() => {});
  };
  if (typeof requestIdleCallback === "function") requestIdleCallback(loadReplay, { timeout: 5000 });
  else setTimeout(loadReplay, 3000);
}

hydrateRoot(document, <HydratedRouter />);
