import type { CollectorRpc } from "@shared/collector";
import type { StateCoreRpc } from "@shared/state-core";

export interface Env {
  CORE: StateCoreRpc;
  COLLECTOR?: CollectorRpc;
  IMAGES: R2Bucket;
  LAG?: KVNamespace;
  CREDENTIALS?: KVNamespace;
  HISTORY?: D1Database;

  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ACCESS_DEV_JWKS?: string;
  ACCESS_CLIENTS?: Record<string, string[]>;
  EMBY_PUBLIC_URL?: string;

  SENTRY_DSN?: string;
  SENTRY_ENVIRONMENT?: string;
  CF_VERSION_METADATA?: WorkerVersionMetadata;
}

// CORE 指向生产状态核心，Preview 必须拒收，避免分支构建写入生产。
export function previewWorkerEnabled(): boolean {
  return process.env.PREVIEW_WORKER?.trim() === "true";
}
