import type { StateCoreRpc } from "@shared/state-core";

/**
 * 采集 Worker 的绑定与变量（wrangler.toml）。字符串变量和 secret 同时进 `process.env`
 * （`nodejs_compat_populate_process_env`），src/lib 的取数模块从那里读；绑定只在这里。
 */
export interface Env {
  /** 采集 Worker 私有：src/lib/cache 的键 */
  COLLECTOR_KV: KVNamespace;
  /** 可滞后层（shared/lag.ts） */
  LAG: KVNamespace;
  /** 共享凭据（shared/credentials.ts），只读 */
  CREDENTIALS: KVNamespace;
  /** 状态核心的具名 entrypoint `StateCore`；按契约接口声明，不引 api 的类 */
  CORE: StateCoreRpc;
  /** 长期归档；本地不绑，归档那一步跳过 */
  HISTORY?: D1Database;

  STORAGE_PREFIX?: string;
  /** 只在本地为 "true"：打开 `POST /__dev/run?job=` */
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
  CF_VERSION_METADATA?: WorkerVersionMetadata;
}
