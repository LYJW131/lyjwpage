import * as Sentry from "@sentry/nextjs";

import { SENTRY_DSN, SENTRY_ENABLED, SENTRY_ENVIRONMENT } from "@/lib/sentry";
import { isKnownLogNoise } from "@/lib/sentry-noise";

Sentry.init({
  dsn: SENTRY_DSN,
  enabled: SENTRY_ENABLED,
  environment: SENTRY_ENVIRONMENT,
  tracesSampleRate: 0.1,
  enableLogs: true,
  // 请求头与正文不进事件：sendDefaultPii 关着时 RequestData 仍把请求头原样写进 event.request，/api/revalidate 的
  // Authorization 就是密钥。Http 集成别跟着覆盖，Next SDK 给它配了 disableIncomingRequestSpans。
  integrations: [
    Sentry.consoleLoggingIntegration({ levels: ["warn", "error"] }),
    Sentry.requestDataIntegration({ include: { cookies: false, data: false, headers: false } }),
  ],
  beforeSendLog: (log) => (isKnownLogNoise(log.message) ? null : log),
  sendDefaultPii: false,
});
