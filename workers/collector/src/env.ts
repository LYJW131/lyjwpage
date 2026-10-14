import type { DigestRpc } from "@shared/digest";
import type { MusicKitTokenEnv } from "@shared/musickit-token";
import type { StateCoreRpc } from "@shared/state-core";

export interface Env extends MusicKitTokenEnv {
  COLLECTOR_KV: KVNamespace;
  LAG: KVNamespace;
  CREDENTIALS: KVNamespace;
  APPLE_CACHE?: KVNamespace;
  APPLE_LOOKUPS: Pick<Fetcher, "fetch">;
  CORE: StateCoreRpc;
  DIGEST?: DigestRpc;
  HISTORY?: D1Database;

  STORAGE_PREFIX?: string;
  DEV_TRIGGERS?: string;

  APPLE_MUSIC_STOREFRONT?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  SITE_WORKER_TAG?: string;
  SITE_ANALYTICS_SITES?: string;

  GITHUB_TOKEN?: string;
  GITHUB_DISPATCH_TOKEN?: string;
  CLOUDFLARE_METRICS_TOKEN?: string;
  SENTRY_API_TOKEN?: string;
  PAGESPEED_API_KEY?: string;
  APPLE_MUSIC_OWNER_NAME?: string;

  SENTRY_DSN?: string;
  SENTRY_ENVIRONMENT?: string;
  SENTRY_CRON_CHECKINS?: string;
  CF_VERSION_METADATA?: WorkerVersionMetadata;
}
