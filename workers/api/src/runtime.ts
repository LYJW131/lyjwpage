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
  /** 只在本地：LivePushRoom 转发上游推送前查假数据注入，见 dev-override-reader.ts */
  DEV_OVERRIDE_READER?: Service<DevOverrideReader>;
  /** 长期归档：pulse 事实表，以及收下奖杯信封后的 trophies 表。不绑就不归档。 */
  HISTORY?: D1Database;
  /** 共享凭据（shared/credentials.ts）：上报入口写 Mac 推来的 Apple Music user token，这里只读（歌词、曲目查询） */
  CREDENTIALS?: KVNamespace;
  /** 可滞后层（shared/lag.ts）：公开读取端点只读 */
  LAG?: KVNamespace;
  /** Worker 调站点 /api/revalidate 用的密钥，只有 Worker 和 Vercel 两边有。 */
  REVALIDATE_SECRET?: string;
  /** TypeSafe AI 的 API 密钥，给 pulse 活动分用（Jev 评估模型）。不配就不打分。 */
  TYPESAFE_API_KEY?: string;
  /** 存储导入（`/api/internal/storage/import`）的鉴权密钥：初始化空的 StateHub、导入数据用（scripts/migrate-state-storage.mjs），不授予站点。 */
  STATE_IMPORT_SECRET?: string;
  STORAGE_PREFIX?: string;
  SITE_URL?: string;
  ALLOWED_ORIGINS?: string;
  /** Sentry 的公开写入地址；不配就不上报（本地 wrangler.test.toml 即如此），见 src/sentry.ts。 */
  SENTRY_DSN?: string;
  /** 不配时按生产 / Preview 自动判断；本地试 Sentry 时设 development。 */
  SENTRY_ENVIRONMENT?: string;
  /** Sentry SDK 从这里取 release（版本 ID），不在代码里读。 */
  CF_VERSION_METADATA?: WorkerVersionMetadata;
}

/** 夹具、上游兜底和分支影子都不能往共享的 KV、归档或评分里写。 */
function isolatedFromSharedWrites(): boolean {
  return process.env.DEV_OVERRIDES?.trim() === "true" ||
    !!process.env.UPSTREAM_API_URL?.trim() ||
    previewWorkerEnabled();
}

/** Local fixtures and upstream overlays must never reach the shared archive. */
export function historyArchiveEnabled(env: Env): boolean {
  return !!env.HISTORY && !isolatedFromSharedWrites();
}

/** 同一套闸门：本地夹具和上游兜底出来的序列不该被送去打分，更不该覆盖线上那份。 */
export function pulseScoringEnabled(env: Env): boolean {
  return !!env.TYPESAFE_API_KEY?.trim() && !isolatedFromSharedWrites();
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
