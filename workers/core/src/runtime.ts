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
  AI?: Ai;
  LAG?: KVNamespace;
  SITE_CACHE?: SiteCacheRpc;
  // 此刻活动卡的封面：R2 读对象键，IMAGES 裁 160px；本地 test 配置没有这两个绑定就纯文字出卡。
  IMAGE_OBJECTS?: R2Bucket;
  IMAGES?: ImagesBinding;
  STORAGE_PREFIX?: string;
  ALLOWED_ORIGINS?: string;
  AI_SERVICE?: Pick<Fetcher, "fetch">;
}

// 本地夹具与上游覆盖值不能进入共享归档或覆盖生产评分。
function isolatedFromSharedWrites(): boolean {
  return process.env.DEV_OVERRIDES?.trim() === "true" ||
    !!process.env.UPSTREAM_API_URL?.trim() ||
    previewWorkerEnabled();
}

export function historyArchive(env: Env): D1Database | null {
  return env.HISTORY && !isolatedFromSharedWrites() ? env.HISTORY : null;
}

export function pulseScoringAi(env: Env): Ai | null {
  return env.AI && !isolatedFromSharedWrites() ? env.AI : null;
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
