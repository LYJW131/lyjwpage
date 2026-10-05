import type { StateCoreRpc } from "@shared/state-core";

export interface Env {
  COLLECTOR_KV: KVNamespace;
  LAG: KVNamespace;
  CREDENTIALS: KVNamespace;
  CORE: StateCoreRpc;
  HISTORY?: D1Database;

  STORAGE_PREFIX?: string;
  DEV_TRIGGERS?: string;

  APPLE_MUSIC_STOREFRONT?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  VERCEL_PROJECT_ID?: string;
  VERCEL_TEAM_ID?: string;

  GITHUB_TOKEN?: string;
  VERCEL_TOKEN?: string;
  CLOUDFLARE_METRICS_TOKEN?: string;
  SENTRY_API_TOKEN?: string;
  PAGESPEED_API_KEY?: string;

  SENTRY_DSN?: string;
  SENTRY_ENVIRONMENT?: string;
  SENTRY_CRON_CHECKINS?: string;
  CF_VERSION_METADATA?: WorkerVersionMetadata;
}
