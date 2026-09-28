/**
 * 状态核心（api Worker）对内公开的 RPC 契约。
 *
 * 上报入口与采集 Worker 都经 Service Binding 调它的具名 entrypoint `StateCore`，
 * Cloudflare 内部调用不再鉴权：只有声明了这个 binding 的 Worker 调得到，每个
 * Worker 对内能做什么，就是下面这几个方法。只放类型，调用方和实现方各自 import。
 *
 * 方法只能加不能改：api 与调用方分开部署，新方法先随 api 上线，调用方后推。
 */

import type { ListeningItem } from "@/lib/types";

/** 和 HTTP 上报同一份回执：状态码 + JSON 正文，调用方原样转给上报器 */
export type CoreReply = { status: number; body: unknown };

/** PS5 电源开关（Home Assistant 报的那份）；从没报过为 null */
export type CorePower = { on: boolean; observedAt: number } | null;

export interface StateCoreRpc {
  /** 一封已经过鉴权的上报。来源必须是 ingest 认得的那几个 */
  ingest(source: string, raw: string): Promise<CoreReply>;
  /** 开着的页面数（推送房间的连接，含后台标签页），同 `/count` 的 connections */
  connections(): Promise<number>;
  playstationPower(): Promise<CorePower>;
  /** Apple Music API 的 developer token；私钥只在 api 上，调用方按到期时刻自己缓存 */
  appleDeveloperToken(): Promise<{ token: string; expiresAt: number }>;
  /** 采集 Worker 拉到的最近在听：差分、推送 `listening`、记听歌痕迹都在状态核心里做 */
  commitRecentlyPlayed(items: ListeningItem[]): Promise<{ changed: boolean }>;
  /** 首屏缓存失效。写入方发起，密钥只在状态核心上 */
  revalidate(tags: string[]): Promise<void>;
}
