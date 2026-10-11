import * as Sentry from "@sentry/react";

import { SENTRY_DSN, SENTRY_ENABLED, SENTRY_ENVIRONMENT } from "@/lib/sentry";
import { redactSentryEvent } from "@/lib/sentry-redact";

Sentry.init({
  dsn: SENTRY_DSN,
  enabled: SENTRY_ENABLED,
  environment: SENTRY_ENVIRONMENT,
  release: process.env.COMMIT_SHA || undefined,
  tunnel: "/relay",
  tracesSampleRate: 0.1,
  enableLogs: true,
  integrations: [
    Sentry.browserTracingIntegration(),
    Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] }),
  ],
  beforeSend: (event) => redactSentryEvent(event),
  beforeSendTransaction: (event) => redactSentryEvent(event),
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 1,
  sendDefaultPii: false,
});

if (SENTRY_ENABLED) {
  const loadReplay = () => {
    import("@/lib/sentry-replay").then(({ attachReplay }) => attachReplay()).catch(() => {});
  };
  if (typeof requestIdleCallback === "function") requestIdleCallback(loadReplay, { timeout: 5000 });
  else setTimeout(loadReplay, 3000);
}
