/**
 * 推送房间的人头数：一条连接、两个口径。
 *
 * - `connections`：开着的页面，含后台标签页。静默 `CONNECTION_STALE_MS` 不计数、
 *   `CONNECTION_CLOSE_MS` 才关 —— 后台标签页的定时器会被浏览器节流到最多每分钟一响，
 *   锁屏、移动端后台还会被整个冻结，随时会解冻回来，关掉只会逼它重连。
 * - `online`：此刻**可见**的页面。页面在握手 URL（`?visible=1`）和之后的
 *   `visible` / `hidden` 消息里报自己的可见性，记在连接的 attachment 上。静默
 *   `VISIBLE_STALE_MS`（三个心跳周期）就不算：可见页面的定时器不被节流，一条僵尸若
 *   按 `connections` 的口径多活，就会把两处调频上报（采集 Worker 的 PlayStation、
 *   agents-reporter）多钉在快档那么久。
 *
 * 纯函数，房间（origin-worker.ts 的 LivePushRoom）把运行时的东西喂进来。
 */

/**
 * 浏览器定时发 "ping"（间隔是 src/hooks/use-live-events.ts 的 HEARTBEAT_MS），运行时
 * 用 setWebSocketAutoResponse 直接回、不唤醒房间。下面两条线从它推，改站点那侧的
 * 间隔就得回来改这个常数。
 */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/** 静默这么久就不算「开着」 */
export const CONNECTION_STALE_MS = 5 * 60_000;
/** 静默这么久就关掉。「不计数」和「关掉」是两条线，理由见文件头 */
export const CONNECTION_CLOSE_MS = 30 * 60_000;
/**
 * 静默这么久就不算「可见」。三个心跳周期：连丢两次 ping 还算，第三次也没到才不算 ——
 * 贴着心跳间隔画线，网络抖一下活人就会在人数里闪没。
 */
export const VISIBLE_STALE_MS = HEARTBEAT_INTERVAL_MS * 3;

/** 连接上的 attachment。`serializeAttachment` 整份替换，改一个字段也要带上其余的 */
export type SocketMark = {
  /** 接入时刻 */
  at: number;
  /** 页面最近一次报的可见性 */
  visible: boolean;
  /** 最近一次收到页面消息（可见性切换）的时刻 */
  seenAt: number;
};

export type SocketSample<T> = {
  socket: T;
  /** 运行时替我们记的最近一次 ping 自动回复时刻 */
  pinged: number | null;
  mark: SocketMark | null;
};

export type Census<T> = {
  connections: number;
  online: number;
  /** 静默太久、该关掉的连接 */
  expired: T[];
};

/** 读回 attachment。没有 visible 字段的连接（实例更新前接进来的）按不可见算 */
export function readMark(raw: unknown, fallbackAt: number | null = null): SocketMark | null {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
  const at = typeof value?.at === "number" ? value.at : fallbackAt;
  if (at === null) return null;
  return {
    at,
    visible: value?.visible === true,
    seenAt: typeof value?.seenAt === "number" ? value.seenAt : at,
  };
}

export function takeCensus<T>(samples: Iterable<SocketSample<T>>, now: number): Census<T> {
  let connections = 0;
  let online = 0;
  const expired: T[] = [];
  for (const { socket, pinged, mark } of samples) {
    // 刚从后台切回来的页面，最近一次 ping 可能是一分钟前被节流的那次；切换消息本身也算它活着
    const lastSeen = Math.max(pinged ?? -Infinity, mark?.at ?? -Infinity, mark?.seenAt ?? -Infinity);
    // 什么都没有：没有 attachment、此后一个 ping 都没发过的连接
    const silentMs = Number.isFinite(lastSeen) ? now - lastSeen : Number.POSITIVE_INFINITY;
    if (silentMs <= CONNECTION_STALE_MS) connections += 1;
    else if (silentMs > CONNECTION_CLOSE_MS) expired.push(socket);
    // 时钟往回跳会让 silentMs 成负数：宁可多数一个人，也别把活人数没
    if (mark?.visible && silentMs <= VISIBLE_STALE_MS) online += 1;
  }
  return { connections, online, expired };
}

/** 页面报可见性的两条消息；别的（含运行时自己回掉的 "ping"）一律不认 */
export function parseVisibility(message: unknown): boolean | null {
  if (message === "visible") return true;
  if (message === "hidden") return false;
  return null;
}
