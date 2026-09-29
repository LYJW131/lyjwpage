"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useSWRConfig } from "swr";

import type { ScopedMutator } from "swr";

import { mergeChargerHistory } from "@/lib/charger-history";
import type { LiveEvent } from "@/lib/live-events";
import { acceptPush } from "@/lib/status-reads";
import { liveSocketUrl } from "@/lib/live-socket";
import { EARLY_LIVE_SOCKET_KEY, type EarlyLiveSocket } from "@/lib/live-socket-boot";
import { APP_VERSION_PATH } from "@/lib/app-version";
import {
  CHARGER_PATH,
  CODING_NOW_PATH,
  DESKTOP_PATH,
  NOW_LISTENING_PATH,
  POWERBANK_PATH,
  TROPHIES_PATH,
} from "@/lib/paths";
import { isRealtimeViewPath, pathByEvent } from "@/lib/status-views";
import type { ChargerPayload, StatusResponse } from "@/lib/types";
import { LIVE_HEARTBEAT_MS } from "@shared/live-heartbeat";

/**
 * 事件名 → 写哪个 SWR 缓存键，以及写进去之前要不要先过一道合并。
 *
 * 全都 revalidate: false —— 推来的就是最新的，没必要再回源确认一次。
 */
const FORWARDS: ReadonlyArray<{
  event: LiveEvent["type"];
  merge?: (data: unknown) => unknown | null;
  /** 写完这份之后还要让哪些**正挂着**的键重取一次（推来的只是摘要、明细在别的键上） */
  refetch?: (key: string) => boolean;
}> = [
  { event: "desktop" },
  { event: "listening-now" },
  // Emby 正在播放：webhook 和推送代理驱动，服务端手上已经是最新的
  { event: "watching-now" },
  /**
   * 两张列表也直接带数据来：只发失效通知的话，每个在线标签页都要各回源一次。
   * 服务端那侧只在内容真的变了时才发，所以这两行不会退化成定时广播。
   */
  { event: "listening" },
  { event: "watching" },
  { event: "playing-now" },
  { event: "playing" },
  /**
   * 奖杯只推摘要：提要、瓷砖上的杯数直接换。展开着的那块瓷砖明细在
   * `?titleids=` 的切片键上，推来的不含逐个奖杯，让它自己重取那一两款。
   */
  {
    event: "trophies",
    refetch: (key) => key.startsWith(`${TROPHIES_PATH}?`),
  },
  /**
   * 充电头在插拔、换设备，以及那之后的收敛窗口里来事件（判据见 lib/charging-settling）。
   * 曲线的合并走和轮询同一个累加器（lib/charger-history）：推来的那份不带历史点
   * （空增量），所以合并只是把已有曲线原样接上 —— 游标不会被扰动，下一轮轮询照常
   * 从正确的位置继续拉。
   */
  {
    event: "charger",
    merge: (data) => mergeChargerHistory(data as ChargerPayload),
  },
  /**
   * 充电宝的发送时机和充电头同一套（结构变化加收敛窗口）。它没有历史曲线，推来的
   * 整份快照直接替换即可，不用像充电头那样合并增量。
   */
  { event: "powerbank" },
  /** coding agent 此刻：整份 `/api/status/coding/now`，直接换 */
  { event: "coding-now" },
];

/**
 * 上报器上下线时要重取的键。
 *
 * 只有 Mac 上报器供数、并且还在轮询的那几张卡在列。充电头和充电宝的「还连着没有」
 * 由浏览器拿各自 payload 里的 declaredOffline 判，所以两张都得换到新的那份。
 * 时区只吃首屏，不在这里重取。Emby 正在看不在其中 —— 那条的数据来自 Emby 的 webhook
 * 和 NAS 上的推送代理，和 Mac 上报器无关，Mac 睡了不影响你在 Emby 上看什么，
 * 跟着重取纯属白跑一趟。
 *
 * coding 只有此刻那份在列：用量、限额、年度都是累计的历史事实，Mac 掉线它们不会
 * 变得不可信，只是不再增长。要的只是活动灯里 mac 那一路 —— 靠 declaredOffline 才能
 * 在优雅离开时立刻灭；别的来源（账号、云端）的灯不受 Mac 存活影响。
 * 崩溃 / 断网那条不指望这里：mac 那一路的时刻不再前进，`CODING_ACTIVE_WINDOW_MS`
 * （lib/coding-agents）到点自己灭。
 */
const PRESENCE_PATHS = [
  DESKTOP_PATH,
  NOW_LISTENING_PATH,
  CHARGER_PATH,
  POWERBANK_PATH,
  CODING_NOW_PATH,
];

/**
 * 不带数据的事件 → 收到后要重取哪几个键。
 *
 * 存活：亲口离线要重取 declaredOffline；超时那条浏览器拿 lastSeenAt 现算，
 * 但优雅离开发生在心跳窗口内，本地钟还没走到。
 * 版本：部署完成后的更新提示，见 lib/live-events 的 `version`。
 */
const INVALIDATIONS: ReadonlyArray<{
  event: LiveEvent["type"];
  paths: readonly string[];
}> = [
  // 上报器上下线：不带数据，只让它供数的那几张卡重取一次，换新的 declaredOffline
  { event: "presence", paths: PRESENCE_PATHS },
  // 新部署接管了生产域名：重问 /api/version，由域名上那一版自己回答，不信推来的 sha
  { event: "version", paths: [APP_VERSION_PATH] },
];

const FORWARD_BY_EVENT = new Map(
  FORWARDS.map((entry) => {
    const path = pathByEvent(entry.event);
    if (!path) throw new Error(`live event "${entry.event}" has no status path`);
    return [entry.event, { ...entry, path }] as const;
  }),
);
const INVALIDATION_BY_EVENT = new Map(INVALIDATIONS.map((entry) => [entry.event, entry]));

/** 推送房间广播过来的信封，形状就是服务端那份 LiveEvent */
type Incoming = { type: LiveEvent["type"]; payload: unknown };

/** 页脚「Online now」读的两个键，只由这条连接写 */
export const ONLINE_COUNT_KEY = "worker:online-count";
export const ONLINE_CONNECTED_KEY = "worker:online-connected";

function dispatch(mutate: ScopedMutator, message: Incoming): void {
  // 在线人数不是状态端点，没有 FORWARDS 那种路径，单独写进页脚的键
  if (message.type === "online") {
    const online = (message.payload as { online?: unknown } | null)?.online;
    if (typeof online === "number") void mutate(ONLINE_COUNT_KEY, online, { revalidate: false });
    return;
  }

  const forward = FORWARD_BY_EVENT.get(message.type);
  if (forward) {
    // 推来的图片地址已经是 `/img/<objectKey>` 同源路径，和轮询拿到的一样，原样写入
    const data = forward.merge ? forward.merge(message.payload) : message.payload;
    if (data == null) return;
    const envelope: StatusResponse<unknown> = { ok: true, data };
    // 登记这一代，好让之后回来的旧轮询结果被挡掉（lib/status-reads）。
    // 顺手也挡住乱序到达的推送本身
    if (!acceptPush(forward.path, envelope)) return;
    void mutate(forward.path, envelope, { revalidate: false });
    const refetch = forward.refetch;
    if (refetch) void mutate((key) => typeof key === "string" && refetch(key));
    return;
  }

  const invalidation = INVALIDATION_BY_EVENT.get(message.type);
  if (invalidation) {
    for (const path of invalidation.paths) void mutate(path);
  }
}

function receive(mutate: ScopedMutator, raw: unknown): void {
  // 心跳的 "pong" 也从这里过，不是 JSON，解析失败就当没看见
  if (typeof raw !== "string" || raw === "pong") return;
  let message: Incoming;
  try {
    message = JSON.parse(raw) as Incoming;
  } catch {
    return;
  }
  if (!message || typeof message.type !== "string") return;
  dispatch(mutate, message);
}

/**
 * 整页共用一条连接。
 *
 * 有多个组件要读活动状态（Live Desk 的前台应用、Recently Played 的本机
 * 播放、页脚的在线人数），如果每个都自己建一条 WebSocket，一个页面就会占掉好几条
 * 长连接。所以连接做成模块级单例，按订阅者数量开关。
 */
let socket: WebSocket | null = null;
let refCount = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let retryAttempts = 0;
let activeMutate: ScopedMutator | null = null;
/** 房间眼下以为这一页可见与否：握手参数带过去的，或最近一次成功发出去的 */
let reportedVisible: boolean | null = null;

/**
 * 连接状态，给 useStatus 调轮询用：连着时推送覆盖整份的实时卡只留兜底轮询，
 * 断开时回到卡片自己的快间隔（lib/poll-schedule 的 realtimeInterval）。
 */
let connected = false;
/** 这一页连上过没有：再连上（重连）时要补取断线期间漏掉的推送 */
let everConnected = false;
const connectionListeners = new Set<() => void>();

function publishConnected(next: boolean): void {
  if (connected === next) return;
  connected = next;
  for (const listener of connectionListeners) listener();
}

function subscribeConnection(listener: () => void) {
  connectionListeners.add(listener);
  return () => connectionListeners.delete(listener);
}

/** 推送 WebSocket 此刻连着没有。服务端渲染和没配实时服务时都是 false */
export function useLiveSocketConnected(): boolean {
  return useSyncExternalStore(subscribeConnection, () => connected, () => false);
}

/**
 * 心跳间隔。Worker 那侧用 setWebSocketAutoResponse 直接回 "pong"，不唤醒实例，
 * 所以这条保活对它是免费的；没有它中间的代理会把空转的连接掐掉。
 *
 * 房间判「可见的页面还在不在」的线（workers/api/src/live-census.ts 的 VISIBLE_STALE_MS）
 * 从共享的心跳间隔推导。
 */
const MAX_BACKOFF_MS = 30_000;

function pageVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

function setConnected(value: boolean): void {
  publishConnected(value);
  if (activeMutate) void activeMutate(ONLINE_CONNECTED_KEY, value, { revalidate: false });
}

function clearTimers(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

function teardown(): void {
  clearTimers();
  reportedVisible = null;
  if (!socket) return;
  // 先摘监听再关：否则自己调的 close 会触发 onclose、排一次不该有的重连
  socket.onopen = null;
  socket.onmessage = null;
  socket.onclose = null;
  socket.onerror = null;
  try {
    socket.close();
  } catch {}
  socket = null;
}

/**
 * 把此刻的可见性告诉房间（`visible` / `hidden`）。和房间眼下以为的一样就不发：
 * 每条都会唤醒休眠中的房间。连接还没开好时先不发，onReady 里再对一次。
 */
function reportVisibility(): void {
  const ws = socket;
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  const visible = pageVisible();
  if (visible === reportedVisible) return;
  try {
    ws.send(visible ? "visible" : "hidden");
    reportedVisible = visible;
  } catch {}
}

/**
 * 把 `<head>` 里内联脚本早开的那条连接取走（见 lib/live-socket-boot）。
 *
 * 先从 window 上摘掉再判断状态：不管接不接得上，那个字段都不该留到下一次 open。
 * 内联脚本装的 handler 在这里就卸掉 —— 接下来 open 会装自己的，两次赋值之间
 * 是同步的，排队中的 message 事件真正派发时读到的已经是新 handler，不会丢。
 */
function adoptEarlySocket(): EarlyLiveSocket | null {
  if (typeof window === "undefined") return null;
  const early = window[EARLY_LIVE_SOCKET_KEY];
  if (!early) return null;
  delete window[EARLY_LIVE_SOCKET_KEY];
  if (early.watchdog) clearTimeout(early.watchdog);
  early.socket.onmessage = null;
  early.socket.onclose = null;
  early.socket.onerror = null;
  const state = early.socket.readyState;
  if (state !== WebSocket.CONNECTING && state !== WebSocket.OPEN) {
    try {
      early.socket.close();
    } catch {}
    return null;
  }
  return early;
}

function open(mutate: ScopedMutator): void {
  if (socket) return;
  const base = liveSocketUrl();
  // 没配实时服务：卡片照常轮询，只是不会被推着翻
  if (!base || typeof window === "undefined") return;

  const early = adoptEarlySocket();
  let ws: WebSocket;
  if (early) {
    ws = early.socket;
    // 内联脚本只在可见时起手，握手带的是 visible=1
    reportedVisible = true;
  } else {
    const visible = pageVisible();
    try {
      ws = new WebSocket(`${base}?visible=${visible ? 1 : 0}`);
    } catch (error) {
      console.error("[live]", error instanceof Error ? error.message : String(error));
      return;
    }
    reportedVisible = visible;
  }
  socket = ws;

  /**
   * 连上之后要做的事。单独拎出来是因为**接手的那条多半已经 open 了** ——
   * 内联脚本在 hydration 之前起手，而这里是 hydration 之后才跑，`onopen` 早就
   * 过去了，只挂 handler 的话心跳和「已连接」永远不会被点亮。
   */
  const onReady = () => {
    retryAttempts = 0;
    const reconnect = everConnected;
    everConnected = true;
    setConnected(true);
    /**
     * 重连：断开期间的推送丢了，挂着的实时视图各回源一次。走 SWR 的 mutate，
     * 所以照样经过 useStatus 的 guardPolled，不会把连上后先到的推送盖回去。
     * 首次连上不用：挂载校验已经补过 HTML 生成后到连上之间那段。
     */
    if (reconnect) void mutate((key) => typeof key === "string" && isRealtimeViewPath(key));
    // 握手之后可见性可能已经变了（排队重连期间切过标签），对一次
    reportVisibility();
    heartbeatTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send("ping");
        } catch {}
      }
    }, LIVE_HEARTBEAT_MS);
  };

  ws.onmessage = (event) => receive(mutate, event.data);

  ws.onerror = () => {
    // onerror 之后紧跟着就是 onclose，重连排在那里，这里不重复排
    try {
      ws.close();
    } catch {}
  };

  ws.onclose = () => {
    teardown();
    setConnected(false);
    if (refCount <= 0) return;
    /**
     * 退避重连：裸 WebSocket 没有自带重连。少了它，实时服务重启一次页面就再也不会
     * 被推着翻，直到下一次整页刷新。
     */
    const delay = Math.min(1_000 * Math.pow(1.5, retryAttempts), MAX_BACKOFF_MS);
    retryAttempts += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (refCount > 0) open(mutate);
    }, delay);
  };

  if (ws.readyState === WebSocket.OPEN) onReady();
  else ws.onopen = onReady;

  // 交接前攒下的消息按顺序重放。放在装完 handler 之后、同步执行：排队中还没派发的
  // 那些随后才到，顺序不会颠倒
  if (early) for (const raw of early.queue) receive(mutate, raw);
}

function close(): void {
  retryAttempts = 0;
  teardown();
  setConnected(false);
}

/**
 * 切标签只报一声，不断开：连接闲置时只有心跳，成本远低于反复重连。
 * 切回来时如果连接正在退避重连，就别再等了。
 */
function handleVisibilityChange(): void {
  if (refCount <= 0 || !activeMutate) return;
  if (socket) {
    reportVisibility();
    return;
  }
  if (pageVisible()) {
    retryAttempts = 0;
    clearTimers();
    open(activeMutate);
  }
}

/**
 * 从 bfcache 回来时补连。进 bfcache 时浏览器可能把连接掐了，恢复时 visibilitychange
 * 不一定触发（Safari 上只发 pageshow），没有这条路页面会一直停在断开状态。
 */
function handlePageShow(event: PageTransitionEvent): void {
  if (!event.persisted || refCount <= 0 || !activeMutate) return;
  if (socket && socket.readyState <= WebSocket.OPEN) {
    reportVisibility();
    return;
  }
  teardown();
  retryAttempts = 0;
  open(activeMutate);
}

/**
 * 订阅服务端推送。
 *
 * 推来的活动状态直接写进 SWR 缓存，所以组件那边照旧用 useStatus 读，
 * 不用管数据是推来的还是轮询来的。
 *
 * 连接状态经 useLiveSocketConnected 暴露给 useStatus：连着时让推送覆盖整份的卡
 * 退成兜底轮询，断开时回到卡片自己的间隔（lib/poll-schedule 的 realtimeInterval）。
 * ONLINE_CONNECTED_KEY 只给页脚那个点用。
 */
export function useLiveEvents() {
  const { mutate } = useSWRConfig();
  useEffect(() => {
    activeMutate = mutate;
    refCount += 1;
    if (refCount === 1 && typeof document !== "undefined") {
      document.addEventListener("visibilitychange", handleVisibilityChange);
      window.addEventListener("pageshow", handlePageShow);
    }
    open(mutate);
    return () => {
      refCount -= 1;
      if (refCount <= 0) {
        refCount = 0;
        close();
        if (typeof document !== "undefined") {
          document.removeEventListener("visibilitychange", handleVisibilityChange);
          window.removeEventListener("pageshow", handlePageShow);
        }
        activeMutate = null;
      }
    };
  }, [mutate]);
}
