/**
 * 状态核心（api Worker）对内公开的 RPC 契约。
 *
 * 上报入口（workers/ingress）与采集 Worker 都经 Service Binding 调它的具名 entrypoint
 * `StateCore`，Cloudflare 内部调用不做二次鉴权：只有声明了这个 binding 的 Worker 调得到，每个
 * Worker 对内能做什么，就是下面这几个方法。只放类型，调用方和实现方各自 import。
 *
 * 方法只能加不能改：api 与调用方分开部署，新方法先随 api 上线，调用方后推。
 */

import type { ListeningItem } from "@/lib/types";
import type { CoreCommand } from "@shared/ingest/prepare";

/**
 * 一封上报的实时那一半提交之后的回执。
 *
 * - `ready: false`：状态存储还没初始化，什么都没写（上报入口回 503）。
 * - `ok: true`：整封收下，`data` 是各来源 commit 的回执（上报入口原样放进 202 的 `data`）。
 * - `ok: false`：某个模块在状态核心里抛了错，`error` 是原因。排在它前面、已经承诺过的写
 *   照样落库、照样推送（见 workers/api/src/ingest-effects.ts）。
 */
export type CommitReply =
  | { ready: false; ok: false }
  | { ready: true; ok: true; data: unknown }
  | { ready: true; ok: false; error: string };

/**
 * 推送房间的人头数。`connections`：开着的页面，含后台标签页；`online`：此刻可见的页面。
 * 调频上报器按「有人可见 → 快档、只是开着 → 中档、都没有 → 闲档」选节奏。
 */
export type CoreAudience = { connections: number; online: number };

/** PS5 电源镜像的只读 RPC 结果；无存储值时为 null。 */
export type CorePower = { on: boolean; observedAt: number } | null;

export interface StateCoreRpc {
  /**
   * 状态存储是否已初始化。上报入口只在 prepare 校验不过时问一次：
   * 未初始化回 503 的优先级高于报文 400。
   */
  ready(): Promise<boolean>;
  /**
   * 一封已经过鉴权、在调用方 prepare 好的上报（shared/ingest），只含状态核心那一半：
   * StateHub 按到达顺序串行提交，推送与首屏失效在状态核心里派发（waitUntil），不经调用方。
   * 可滞后层、归档和凭据由调用方自己写。命令必须能结构化复制。
   */
  commitIngest(command: CoreCommand): Promise<CommitReply>;
  /** 站点新部署接管了生产域名：向推送房间广播不带数据的 `version` 事件，返回送达的连接数 */
  broadcastVersion(): Promise<number>;
  /** 推送房间的两个人头数，同 `/count`（口径见 workers/api/src/live-census.ts） */
  audience(): Promise<CoreAudience>;
  /** 保留内部 RPC 契约；当前无调用者，也无新电源数据写入。 */
  playstationPower(): Promise<CorePower>;
  /** Apple Music API 的 developer token；私钥只在 api 上，调用方按到期时刻自己缓存 */
  appleDeveloperToken(): Promise<{ token: string; expiresAt: number }>;
  /** 采集 Worker 拉到的最近在听：差分、推送 `listening`、记听歌痕迹都在状态核心里做 */
  commitRecentlyPlayed(items: ListeningItem[]): Promise<{ changed: boolean }>;
  /** 首屏缓存失效。写入方发起，密钥只在状态核心上 */
  revalidate(tags: string[]): Promise<void>;
}
