import { AsyncLocalStorage } from "node:async_hooks";
import type { StorageClient } from "@shared/storage-client";
import type { LivePushRoom } from "./index";
import type { MusicKitTokenEnv } from "./musickit-token";
import type { StateHub } from "./state-hub";

export interface Env extends MusicKitTokenEnv {
  LIVE_PUSH: DurableObjectNamespace<LivePushRoom>;
  STATE: DurableObjectNamespace<StateHub>;
  IMAGES: R2Bucket;
  /** Public, rebuildable read models only. Omit to keep the authoritative read path. */
  READ_MODEL?: KVNamespace;
  /** Append-only long-term activity archive. Omit to disable archiving; nothing else reads it. */
  HISTORY?: D1Database;
  TELEMETRY_INGEST_SECRET?: string;
  /** 一次性迁移使用，迁移完成后移除，不授予站点。 */
  STATE_IMPORT_SECRET?: string;
  STORAGE_PREFIX?: string;
  SITE_URL?: string;
  ALLOWED_ORIGINS?: string;
}

/** Local fixtures and upstream overlays must never leak into a shared read model. */
export function readModelEnabled(env: Env): boolean {
  return !!env.READ_MODEL && process.env.DEV_OVERRIDES?.trim() !== "true" &&
    !process.env.UPSTREAM_API_URL?.trim();
}

/** Same guards: local fixtures and upstream overlays must never reach the shared archive. */
export function historyArchiveEnabled(env: Env): boolean {
  return !!env.HISTORY && process.env.DEV_OVERRIDES?.trim() !== "true" &&
    !process.env.UPSTREAM_API_URL?.trim();
}

export type RequestContext = {
  env: Env;
  ctx: Pick<ExecutionContext, "waitUntil">;
  /** 在状态对象内部直读本地 SQLite；普通 Worker 通过 DO binding 调用。 */
  storage?: StorageClient;
};
export const requestStore = new AsyncLocalStorage<RequestContext>();
export function currentContext(): RequestContext {
  const store = requestStore.getStore();
  if (!store) throw new Error("不在请求作用域里");
  return store;
}
