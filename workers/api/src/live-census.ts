// 后台标签页会节流或冻结心跳；停止计数与关闭连接必须采用不同窗口，避免强迫仍存活页面重连。

import { LIVE_HEARTBEAT_MS } from "@shared/live-heartbeat";

export { LIVE_HEARTBEAT_MS as HEARTBEAT_INTERVAL_MS } from "@shared/live-heartbeat";

export const CONNECTION_STALE_MS = 5 * 60_000;
export const CONNECTION_CLOSE_MS = 30 * 60_000;
export const VISIBLE_STALE_MS = LIVE_HEARTBEAT_MS * 3;

// serializeAttachment 整份替换，修改一个字段也必须保留其余字段。
export type SocketMark = {
  at: number;
  visible: boolean;
  seenAt: number;
  relay: boolean;
};

export type SocketSample<T> = {
  socket: T;
  pinged: number | null;
  mark: SocketMark | null;
};

export type Census<T> = {
  connections: number;
  online: number;
  watched: boolean;
  expired: T[];
};

export function readMark(raw: unknown, fallbackAt: number | null = null): SocketMark | null {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const at = typeof value?.at === "number" ? value.at : fallbackAt;
  if (at === null) return null;
  return {
    at,
    visible: value?.visible === true,
    seenAt: typeof value?.seenAt === "number" ? value.seenAt : at,
    relay: value?.relay === true,
  };
}

export function takeCensus<T>(samples: Iterable<SocketSample<T>>, now: number): Census<T> {
  let connections = 0;
  let online = 0;
  let relays = 0;
  const expired: T[] = [];
  for (const { socket, pinged, mark } of samples) {
    // 后台刚恢复时 ping 可能仍是被节流的旧值，可见性消息也必须续活。
    const lastSeen = Math.max(pinged ?? -Infinity, mark?.at ?? -Infinity, mark?.seenAt ?? -Infinity);
    const silentMs = Number.isFinite(lastSeen) ? now - lastSeen : Number.POSITIVE_INFINITY;
    if (silentMs <= CONNECTION_STALE_MS) {
      connections += 1;
      if (mark?.relay) relays += 1;
    } else if (silentMs > CONNECTION_CLOSE_MS) expired.push(socket);
    // 时钟回退产生的负间隔仍视为存活，避免误删在线访客。
    if (mark?.visible && silentMs <= VISIBLE_STALE_MS) online += 1;
  }
  return { connections, online, watched: online + relays > 0, expired };
}

export function parseVisibility(message: unknown): boolean | null {
  if (message === "visible") return true;
  if (message === "hidden") return false;
  return null;
}
