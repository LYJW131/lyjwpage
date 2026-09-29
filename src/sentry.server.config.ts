import * as Sentry from "@sentry/nextjs";

import { SENTRY_DSN, SENTRY_ENABLED, SENTRY_ENVIRONMENT } from "@/lib/sentry";
import { isKnownLogNoise } from "@/lib/sentry-noise";

/**
 * Vercel 函数里的 Sentry：首页重新生成、/api/revalidate、分享图这些服务端渲染。
 * 请求级报错由 instrumentation.ts 的 onRequestError 交给它，不用到处 try/catch。
 */
Sentry.init({
  dsn: SENTRY_DSN,
  enabled: SENTRY_ENABLED,
  environment: SENTRY_ENVIRONMENT,
  tracesSampleRate: 0.1,
  enableLogs: true,
  integrations: [Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] })],
  // 运行时自己打的、与站点无关又稳定重复的那几条不进日志，见 lib/sentry-noise
  beforeSendLog: (log) => (isKnownLogNoise(log.message) ? null : log),
  sendDefaultPii: false,
});
