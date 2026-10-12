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
  SITE_WORKER_TAG?: string;
  SITE_ANALYTICS_SITES?: string;

  GITHUB_TOKEN?: string;
  CLOUDFLARE_METRICS_TOKEN?: string;
  PAGESPEED_API_KEY?: string;
}
