"use client";

import { useEffect } from "react";
import { useSWRConfig } from "swr";

import type { ScopedMutator } from "swr";

import { mergeChargerHistory } from "@/lib/charger-history";
import { assetUrl, objectKeyFromAssetUrl, pageAssetBase } from "@/lib/asset-url";
import type { NowWatchingPayload, WatchingPayload } from "@/lib/emby";
import { applyVibeCodingNow } from "@/lib/vibecoding-activity";
import type { LiveEvent } from "@/lib/live-events";
import { rememberPushed } from "@/lib/live-freshness";
import { liveSocketUrl } from "@/lib/live-socket";
import {
  CHARGER_PATH,
  POWERBANK_PATH,
  DESKTOP_PATH,
  LISTENING_PATH,
  NOW_LISTENING_PATH,
  NOW_PLAYING_PATH,
  NOW_WATCHING_PATH,
  PLAYING_PATH,
  VIBECODING_PATH,
  WATCHING_PATH,
} from "@/lib/paths";
import type {
  ChargerPayload,
  DesktopPayload,
  StatusResponse,
  VibeCodingNowPayload,
  WatchingItem,
} from "@/lib/types";

function localAssetUrl(url: string | null): string | null {
  if (!url) return null;
  const base = pageAssetBase();
  const objectKey = objectKeyFromAssetUrl(url);
  return base && objectKey ? assetUrl(base, objectKey) : url;
}

function localWatchingItem(item: WatchingItem): WatchingItem {
  return {
    ...item,
    poster: localAssetUrl(item.poster),
    backdrop: localAssetUrl(item.backdrop),
  };
}

/** 把写入方推来的资产域换成本页部署自己的交付域。 */
function localizeAssets(event: LiveEvent["type"], payload: unknown): unknown {
  if (event === "desktop") {
    const desktop = (payload as DesktopPayload).desktop;
    return desktop
      ? {
          ...(payload as DesktopPayload),
          desktop: { ...desktop, iconUrl: localAssetUrl(desktop.iconUrl) },
        }
      : payload;
  }
  if (event === "charger") {
    const charger = payload as ChargerPayload;
    return charger.cover
      ? {
          ...charger,
          cover: { ...charger.cover, iconUrl: localAssetUrl(charger.cover.iconUrl) },
        }
      : payload;
  }
  if (event === "watching") {
    const watching = payload as WatchingPayload;
    return { ...watching, items: watching.items.map(localWatchingItem) };
  }
  if (event === "watching-now") {
    const watching = payload as NowWatchingPayload;
    return {
      ...watching,
      current: watching.current ? localWatchingItem(watching.current) : null,
    };
  }
  return payload;
}

/**
 * 事件名 → 写哪个 SWR 缓存键，以及写进去之前要不要先过一道合并。
 *
 * 四条以前是四段几乎一样的绑定，只有键和「要不要合并」不同。
 * 表化之后加一种推送就是加一行。
 *
 * 全都 revalidate: false —— 推来的就是最新的，没必要再回源确认一次。
 */
const FORWARDS: ReadonlyArray<{
  event: LiveEvent["type"];
  path: string;
  merge?: (data: unknown) => unknown | null;
}> = [
  { event: "desktop", path: DESKTOP_PATH },
  { event: "listening-now", path: NOW_LISTENING_PATH },
  // Emby 正在播放：webhook 和推送代理驱动，服务端手上已经是最新的
  { event: "watching-now", path: NOW_WATCHING_PATH },
  /**
   * 两张列表也直接带数据来。
   *
   * 从前它们只发失效通知、由这里 mutate 一次重取，理由是「整份太大」——
   * 实测 4.4 KB 和 2.8 KB，而重取要付的是每个在线标签页各一次回源。
   * 服务端那侧只在内容真的变了时才发，所以这两行不会退化成定时广播。
   */
  { event: "listening", path: LISTENING_PATH },
  { event: "watching", path: WATCHING_PATH },
  { event: "playing-now", path: NOW_PLAYING_PATH },
  { event: "playing", path: PLAYING_PATH },
  /**
   * 充电头只在插拔、换设备时来事件。曲线的合并走和轮询同一个累加器
   * （lib/charger-history）：推来的那份不带历史点（空增量），所以合并只是把
   * 已有曲线原样接上 —— 游标不会被扰动，下一轮轮询照常从正确的位置继续拉。
   */
  {
    event: "charger",
    path: CHARGER_PATH,
    merge: (data) => mergeChargerHistory(data as ChargerPayload),
  },
  /**
   * 充电宝：插拔、充放电切换、热控翻转、整数电量跳格时来事件。曲线整份发，
   * 直接替换即可，不用像充电头那样合并增量。
   */
  { event: "powerbank", path: POWERBANK_PATH },
  /**
   * 只带「此刻」那三个字段。并进手上已有的整份；还没有整份就丢掉，等轮询。
   */
  {
    event: "vibecoding-now",
    path: VIBECODING_PATH,
    merge: (data) => applyVibeCodingNow(data as VibeCodingNowPayload),
  },
];

/**
 * 上报器上下线时要重取的键。
 *
 * 只有 Mac 上报器供数、并且还在轮询的那几张卡在列。时区只吃首屏，没有
 * status 端点可重取。Emby 正在看不在其中 —— 那条的数据来自 Emby 的 webhook
 * 和 NAS 上的推送代理，和 Mac 上报器无关，Mac 睡了不影响你在 Emby 上看什么，
 * 跟着重取纯属白跑一趟。
 *
 * vibe coding 在列，但不是为了整张卡：用量、限额、曲线都是累计的历史事实，
 * Mac 掉线它们不会变得不可信，只是不再增长。要的只是那两盏活动灯 —— 全卡唯一
 * 一处说「此刻」的东西，靠 declaredOffline 才能在优雅离开时立刻灭。
 * 崩溃 / 断网那条不指望这里：浏览器拿 lastSeenAt 现算，到点自己翻。
 */
const PRESENCE_PATHS = [
  DESKTOP_PATH,
  NOW_LISTENING_PATH,
  CHARGER_PATH,
  VIBECODING_PATH,
];

/**
 * 不带数据的事件 → 收到后要重取哪几个键。
 *
 * 只剩存活这一条：亲口离线要重取 declaredOffline；超时那条浏览器拿
 * lastSeenAt 现算，但优雅离开发生在心跳窗口内，本地钟还没走到。
 */
const INVALIDATIONS: ReadonlyArray<{
  event: LiveEvent["type"];
  paths: readonly string[];
}> = [
  // 上报器上下线：不带数据，只让它供数的那几张卡重取一次，换新的 declaredOffline
  { event: "presence", paths: PRESENCE_PATHS },
];

const FORWARD_BY_EVENT = new Map(FORWARDS.map((entry) => [entry.event, entry]));
const INVALIDATION_BY_EVENT = new Map(INVALIDATIONS.map((entry) => [entry.event, entry]));

/** live-push Worker 广播过来的信封，形状就是服务端那份 LiveEvent */
type Incoming = { type: LiveEvent["type"]; payload: unknown };

function dispatch(mutate: ScopedMutator, message: Incoming): void {
  const forward = FORWARD_BY_EVENT.get(message.type);
  if (forward) {
    const localized = localizeAssets(message.type, message.payload);
    const data = forward.merge ? forward.merge(localized) : localized;
    if (data == null) return;
    const envelope: StatusResponse<unknown> = { ok: true, data };
    // 登记这一代，好让之后回来的旧轮询结果被挡掉（lib/live-freshness）。
    // 顺手也挡住乱序到达的推送本身
    if (!rememberPushed(forward.path, envelope)) return;
    void mutate(forward.path, envelope, { revalidate: false });
    return;
  }

  const invalidation = INVALIDATION_BY_EVENT.get(message.type);
  if (invalidation) {
    for (const path of invalidation.paths) void mutate(path);
  }
}

/**
 * 整页共用一条连接。
 *
 * 现在有多个组件要读活动状态（Live Desk 的前台应用、Recently Played 的本机
 * 播放），如果每个都自己建一条 WebSocket，一个页面就会占掉好几条长连接。
 * 所以连接做成模块级单例，按订阅者数量开关。
 */
let socket: WebSocket | null = null;
let refCount = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let retryAttempts = 0;

/**
 * 心跳间隔。Worker 那侧用 setWebSocketAutoResponse 直接回 "pong"，不唤醒实例，
 * 所以这条保活对它是免费的；没有它中间的代理会把空转的连接掐掉。
 */
const HEARTBEAT_MS = 30_000;
const MAX_BACKOFF_MS = 30_000;

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

function open(mutate: ScopedMutator): void {
  if (socket) return;
  const url = liveSocketUrl();
  // 没配实时服务：卡片照常轮询，只是不会被推着翻
  if (!url || typeof window === "undefined") return;

  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
  } catch (error) {
    console.error("[live]", error instanceof Error ? error.message : String(error));
    return;
  }
  socket = ws;

  ws.onopen = () => {
    retryAttempts = 0;
    heartbeatTimer = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        try {
          ws.send("ping");
        } catch {}
      }
    }, HEARTBEAT_MS);
  };

  ws.onmessage = (event) => {
    // 心跳的 "pong" 也从这里过，不是 JSON，解析失败就当没看见
    if (typeof event.data !== "string" || event.data === "pong") return;
    let message: Incoming;
    try {
      message = JSON.parse(event.data) as Incoming;
    } catch {
      return;
    }
    if (!message || typeof message.type !== "string") return;
    dispatch(mutate, message);
  };

  ws.onerror = () => {
    // onerror 之后紧跟着就是 onclose，重连排在那里，这里不重复排
    try {
      ws.close();
    } catch {}
  };

  ws.onclose = () => {
    teardown();
    if (refCount <= 0) return;
    /**
     * 退避重连。pusher-js 时代这是 SDK 自带的，裸 WebSocket 得自己来 ——
     * 少了它，实时服务重启一次页面就再也不会被推着翻，直到下一次整页刷新。
     */
    const delay = Math.min(1_000 * Math.pow(1.5, retryAttempts), MAX_BACKOFF_MS);
    retryAttempts += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (refCount > 0) open(mutate);
    }, delay);
  };
}

function close(): void {
  retryAttempts = 0;
  teardown();
}

/**
 * 订阅服务端推送。
 *
 * 推来的活动状态直接写进 SWR 缓存，所以组件那边照旧用 useStatus 读，
 * 不用管数据是推来的还是轮询来的。
 *
 * 不对外暴露连接状态。从前暴露了一个 connected，让几张卡在断开时把轮询从
 * 30 秒压到 3 秒 —— 但断线几秒内就会被上面那个退避重连自愈，那次加速几乎只
 * 发得出一轮；实时服务真挂了的话压到 3 秒也换不来新数据，只是把请求翻十倍。
 *
 * 不随页面可见性断开：连接闲置时只有心跳，成本远低于反复重连。
 * （在线人数那条是另一套取舍，它按可见性开关 —— 见 use-online-count。）
 */
export function useLiveEvents() {
  const { mutate } = useSWRConfig();
  useEffect(() => {
    refCount += 1;
    open(mutate);
    return () => {
      refCount -= 1;
      if (refCount <= 0) {
        refCount = 0;
        close();
      }
    };
  }, [mutate]);
}
