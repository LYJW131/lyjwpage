export const SENTRY_DSN =
  "https://13d4c7b65d377b6a3e1e546f9d940b9d@o4511888459890688.ingest.us.sentry.io/4512132602331136";

export const SENTRY_ENVIRONMENT = process.env.SENTRY_ENVIRONMENT || "development";

export const SENTRY_ENABLED =
  SENTRY_ENVIRONMENT !== "development" || process.env.NEXT_PUBLIC_SENTRY_DEV === "true";

export const SENTRY_ORG = "yangjunwei-liang";
export const SENTRY_API_ORIGIN = "https://us.sentry.io";
export const SENTRY_SITE_PROJECT_ID = "4512132602331136";
export const SENTRY_WORKER_PROJECT_ID = "4512132602855424";
export const SENTRY_COLLECTOR_PROJECT_ID = "4512164070948864";
export const SENTRY_UPTIME_DETECTOR_ID = "10416301";
export const SENTRY_CRON_MONITOR_SLUG = "api-minute-cron";
export const CRON_HEARTBEAT_EVERY_MINUTES = 5;
