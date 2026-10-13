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
  // 只给 React Router 的 .data 请求带追踪头。/api/* 与页面同源后若也带，已采样的页面开多久，site 读可滞后视图就跟着采多久。
  tracePropagationTargets: [/\.data$/],
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

hydrateRoot(document, <HydratedRouter />, {
  onRecoverableError(error, errorInfo) {
    console.error(error);
    // Sentry 项目开着入站过滤「React hydration errors」，原样的 #418 / #423 会被整条丢掉；换成自己的消息上报才看得到哪里不一致。
    Sentry.captureMessage("Hydration fell back to client rendering", {
      level: "warning",
      extra: {
        reactError: error instanceof Error ? error.message : String(error),
        componentStack: errorInfo.componentStack,
      },
    });
  },
});
