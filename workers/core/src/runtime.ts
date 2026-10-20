import { AsyncLocalStorage } from "node:async_hooks";
import type { SiteCacheRpc } from "@shared/site-cache";
import type { StorageClient } from "@shared/storage-client";
import type { LivePushRoom } from "./origin-worker";
import type { StateHub } from "./state-hub";
import type { DevOverrideReader } from "./dev-override-reader";
import { previewWorkerEnabled } from "./preview";

export interface Env {
  LIVE_PUSH: DurableObjectNamespace<LivePushRoom>;
  STATE: DurableObjectNamespace<StateHub>;
  DEV_OVERRIDE_READER?: Service<DevOverrideReader>;
  HISTORY?: D1Database;
  LAG?: KVNamespace;
  SITE_CACHE?: SiteCacheRpc;
  STORAGE_PREFIX?: string;
  ALLOWED_ORIGINS?: string;
  AI_SERVICE?: Pick<Fetcher, "fetch">;
}

// 本地夹具与上游覆盖值不能进入共享归档。
function isolatedFromSharedWrites(): boolean {
  return process.env.DEV_OVERRIDES?.trim() === "true" ||
    !!process.env.UPSTREAM_API_URL?.trim() ||
    previewWorkerEnabled();
}

export function historyArchive(env: Env): D1Database | null {
  return env.HISTORY && !isolatedFromSharedWrites() ? env.HISTORY : null;
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
