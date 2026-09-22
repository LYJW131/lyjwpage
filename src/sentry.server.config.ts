import * as Sentry from "@sentry/nextjs";

import { SENTRY_DSN, SENTRY_ENABLED, SENTRY_ENVIRONMENT } from "@/lib/sentry";

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
  sendDefaultPii: false,
});
