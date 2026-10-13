import * as Sentry from "@sentry/react";
import { hydrateRoot } from "react-dom/client";
import { HydratedRouter } from "react-router/dom";

import { DOCUMENT_COMMIT_META } from "@/lib/app-version";
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

// Sentry 项目开着入站过滤「React hydration errors」，消息里带 react.dev/errors 链接的报错会被整条丢掉；
// 换成中性的消息，组件栈作 stack 让 Sentry 按 sourcemap 还原，#423 的真正原因在 cause 里另放进 contexts。
function reportRecoverableError(error: unknown, componentStack: string | undefined) {
  console.error(error);
  const message = error instanceof Error ? error.message : String(error);
  const code = /#(\d+)/.exec(message)?.[1] ?? "unknown";
  const cause = error instanceof Error && error.cause instanceof Error ? error.cause : null;
  const report = new Error(`Hydration fell back to client rendering (${code})`);
  report.name = "HydrationFallback";
  if (componentStack) report.stack = `${report.name}: ${report.message}${componentStack}`;
  const htmlCommit = document.querySelector(`meta[name="${DOCUMENT_COMMIT_META}"]`)?.getAttribute("content") ?? null;
  Sentry.captureException(report, {
    level: "warning",
    tags: { "react.code": code, "html.current": String(htmlCommit === commitSha) },
    contexts: {
      react: { message, cause: cause ? `${cause.name}: ${cause.message}` : null, causeStack: cause?.stack ?? null, htmlCommit },
    },
  });
}

hydrateRoot(document, <HydratedRouter />, {
  onRecoverableError: (error, errorInfo) => reportRecoverableError(error, errorInfo.componentStack),
});
