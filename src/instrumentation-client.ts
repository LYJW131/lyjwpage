import * as Sentry from "@sentry/nextjs";

import { SENTRY_DSN, SENTRY_ENABLED, SENTRY_ENVIRONMENT } from "@/lib/sentry";

/**
 * 浏览器端的 Sentry。上报走同源的 /relay（next.config 的 tunnelRoute），
 * 广告拦截和 lyjw131.com 访客直连不上 sentry.io 都不影响。
 *
 * 采样按免费档算：性能追踪 10%（首页常驻 SWR 轮询，太高会很快吃完 span 额度）；
 * console 只收 warn / error 进 Sentry Logs。release 由 withSentryConfig 按
 * VERCEL_GIT_COMMIT_SHA 注入，和页脚那段提交对得上。
 */
Sentry.init({
  dsn: SENTRY_DSN,
  enabled: SENTRY_ENABLED,
  environment: SENTRY_ENVIRONMENT,
  tracesSampleRate: 0.1,
  enableLogs: true,
  integrations: [Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] })],
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

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
