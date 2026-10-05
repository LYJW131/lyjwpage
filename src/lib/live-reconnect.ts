import { LIVE_HEARTBEAT_MS } from "@shared/live-heartbeat";

export const RECONNECT_BASE_MS = 1_000;
export const RECONNECT_MAX_MS = 30_000;
// 撑过两个心跳才算稳定：期间至少走完一次 ping；握手后很快被断的连接若清零退避，会以 1 秒一轮地重连并补取。
export const STABLE_CONNECTION_MS = LIVE_HEARTBEAT_MS * 2;

// 部署或网络抖动会同时断开所有页面；只抖上半截，每轮至少等一半，又把同一时刻的重连摊开。
export function reconnectDelay(attempt: number, random: number): number {
  const ceiling = Math.min(RECONNECT_BASE_MS * 1.5 ** attempt, RECONNECT_MAX_MS);
  return Math.round(ceiling * (0.5 + random / 2));
}

export function attemptsAfterClose(attempts: number, openedAt: number | null, closedAt: number): number {
  return openedAt !== null && closedAt - openedAt >= STABLE_CONNECTION_MS ? 0 : attempts;
}

export type CatchUp = { refetch: boolean; pending: boolean };

// 断线期间漏掉的推送只能靠回源补；页面隐藏时只记下待补，回到前台再取。
export function catchUpOnOpen(state: { reconnect: boolean; visible: boolean; pending: boolean }): CatchUp {
  if (!state.reconnect && !state.pending) return { refetch: false, pending: false };
  return state.visible ? { refetch: true, pending: false } : { refetch: false, pending: true };
}

export function catchUpOnVisible(state: { pending: boolean; visible: boolean; socketOpen: boolean }): CatchUp {
  if (state.pending && state.visible && state.socketOpen) return { refetch: true, pending: false };
  return { refetch: false, pending: state.pending };
}
