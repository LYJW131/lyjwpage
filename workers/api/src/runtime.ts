import { AsyncLocalStorage } from "node:async_hooks";
import type { StorageClient } from "@shared/storage-client";
import type { LivePushRoom } from "./origin-worker";
import type { MusicKitTokenEnv } from "./musickit-token";
import type { StateHub } from "./state-hub";
import type { DevOverrideReader } from "./dev-override-reader";
import { previewWorkerEnabled } from "./preview";

export interface Env extends MusicKitTokenEnv {
  LIVE_PUSH: DurableObjectNamespace<LivePushRoom>;
  STATE: DurableObjectNamespace<StateHub>;
  DEV_OVERRIDE_READER?: Service<DevOverrideReader>;
  HISTORY?: D1Database;
  CREDENTIALS?: KVNamespace;
  LAG?: KVNamespace;
  APPLE_CACHE?: KVNamespace;
  REVALIDATE_SECRET?: string;
  TYPESAFE_API_KEY?: string;
  STATE_IMPORT_SECRET?: string;
  STORAGE_PREFIX?: string;
  SITE_URL?: string;
  ALLOWED_ORIGINS?: string;
  SENTRY_DSN?: string;
  SENTRY_ENVIRONMENT?: string;
  CF_VERSION_METADATA?: WorkerVersionMetadata;
}

// 本地夹具与上游覆盖值不能进入共享归档或覆盖生产评分。
function isolatedFromSharedWrites(): boolean {
  return process.env.DEV_OVERRIDES?.trim() === "true" ||
    !!process.env.UPSTREAM_API_URL?.trim() ||
    previewWorkerEnabled();
}

export function historyArchiveEnabled(env: Env): boolean {
  return !!env.HISTORY && !isolatedFromSharedWrites();
}

export function pulseScoringEnabled(env: Env): boolean {
  return !!env.TYPESAFE_API_KEY?.trim() && !isolatedFromSharedWrites();
}

export type RequestContext = {
  env: Env;
  ctx: Pick<ExecutionContext, "waitUntil">;
  storage?: StorageClient;
};
export const requestStore = new AsyncLocalStorage<RequestContext>();
export function currentContext(): RequestContext {
  const store = requestStore.getStore();
  if (!store) throw new Error("不在请求作用域里");
  return store;
}
