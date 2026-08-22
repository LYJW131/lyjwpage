"use client";

import { useEffect } from "react";
import useSWR, { useSWRConfig } from "swr";
import type { ScopedMutator } from "swr";

import { workerUrl } from "@/lib/worker-url";

export const ONLINE_COUNT_KEY = "worker:online-count";
export const ONLINE_CONNECTED_KEY = "worker:online-connected";

/** 浏览器连的端点。那个 Worker 还开着 /count，但站点只用长连接这条 */
const WS_PATH = "/ws";

/**
 * 只配 Worker 的源，路径在这儿拼 —— 和 live-push、动态封面那两个变量一个形状，
 * 规则见 lib/worker-url。必须写成完整的 `process.env.XXX` 字面量，浏览器那侧
 * 是构建时按文本替换的。
 */
function getOnlineWsUrl(): string | null {
  return workerUrl(process.env.NEXT_PUBLIC_ONLINE_COUNTER_URL, WS_PATH, { websocket: true });
}

let socket: WebSocket | null = null;
let refCount = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let retryAttempts = 0;
let activeMutate: ScopedMutator | null = null;
let isListenersAttached = false;

function cleanupSocket() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (socket) {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
    socket.onerror = null;
    try {
      socket.close();
    } catch {}
    socket = null;
  }
}

function connect(mutate: ScopedMutator) {
  const url = getOnlineWsUrl();
  if (!url || typeof window === "undefined") return;

  // 切到后台或不可见时不建立连接
  if (typeof document !== "undefined" && document.visibilityState === "hidden") {
    return;
  }

  cleanupSocket();

  try {
    const ws = new WebSocket(url);
    socket = ws;

    ws.onopen = () => {
      retryAttempts = 0;
      void mutate(ONLINE_CONNECTED_KEY, true, { revalidate: false });

      // 定时发送心跳保活
      heartbeatTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send("ping");
          } catch {}
        }
      }, 30000);
    };

    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as { online?: number };
        if (typeof payload.online === "number") {
          void mutate(ONLINE_COUNT_KEY, payload.online, { revalidate: false });
        }
      } catch {}
    };

    const handleClose = () => {
      void mutate(ONLINE_CONNECTED_KEY, false, { revalidate: false });
      cleanupSocket();

      // 仅在前台可见且仍有活跃订阅时自动重连
      if (
        refCount > 0 &&
        typeof document !== "undefined" &&
        document.visibilityState !== "hidden"
      ) {
        const delay = Math.min(1000 * Math.pow(1.5, retryAttempts), 30000);
        retryAttempts += 1;
        reconnectTimer = setTimeout(() => {
          if (
            refCount > 0 &&
            typeof document !== "undefined" &&
            document.visibilityState !== "hidden"
          ) {
            connect(mutate);
          }
        }, delay);
      }
    };

    ws.onclose = handleClose;
    ws.onerror = () => {
      try {
        ws.close();
      } catch {}
    };
  } catch (err) {
    console.error("[online-counter] Failed to connect to WebSocket:", err);
    void mutate(ONLINE_CONNECTED_KEY, false, { revalidate: false });
  }
}

function handleVisibilityChange() {
  if (!activeMutate || refCount <= 0) return;

  if (document.visibilityState === "visible") {
    retryAttempts = 0;
    connect(activeMutate);
  } else {
    cleanupSocket();
    void activeMutate(ONLINE_CONNECTED_KEY, false, { revalidate: false });
  }
}

/**
 * 只挂 pagehide，不挂 beforeunload。
 *
 * 两者要做的事一模一样（关连接、把 connected 置 false），而 beforeunload 是
 * 浏览器判定「本页不进 back/forward cache」的经典触发器 —— Safari / Firefox
 * 直接排除，Chrome 记一条 blocking reason。整站因此在前进后退时都要重新水合、
 * 重连两条 WebSocket、重跑所有轮询。
 */
function handlePageHide() {
  cleanupSocket();
  if (activeMutate) {
    void activeMutate(ONLINE_CONNECTED_KEY, false, { revalidate: false });
  }
}

/**
 * 从 bfcache 回来时重连。
 *
 * 进 bfcache 前 handlePageHide 已经把 socket 关了，而恢复时 visibilitychange
 * 不一定触发（Safari 上只发 pageshow），没有这条路人数会一直停在「已断开」。
 */
function handlePageShow(event: PageTransitionEvent) {
  if (!event.persisted || !activeMutate || refCount <= 0) return;
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return;
  retryAttempts = 0;
  connect(activeMutate);
}

export function subscribeOnlineCount(mutate: ScopedMutator): () => void {
  activeMutate = mutate;
  refCount += 1;

  if (!isListenersAttached && typeof document !== "undefined" && typeof window !== "undefined") {
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("pageshow", handlePageShow);
    isListenersAttached = true;
  }

  if (refCount === 1) {
    connect(mutate);
  }

  return () => {
    refCount -= 1;
    if (refCount <= 0) {
      refCount = 0;
      retryAttempts = 0;
      cleanupSocket();
      void mutate(ONLINE_CONNECTED_KEY, false, { revalidate: false });

      if (isListenersAttached && typeof document !== "undefined" && typeof window !== "undefined") {
        document.removeEventListener("visibilitychange", handleVisibilityChange);
        window.removeEventListener("pagehide", handlePageHide);
        window.removeEventListener("pageshow", handlePageShow);
        isListenersAttached = false;
      }
      activeMutate = null;
    }
  };
}

/**
 * 实时获取 Cloudflare Workers 统计的同时在线人数（前台活跃可见）与 WebSocket 连接状态。
 */
export function useOnlineCount(): { count: number | undefined; connected: boolean } {
  const { mutate } = useSWRConfig();

  useEffect(() => {
    return subscribeOnlineCount(mutate);
  }, [mutate]);

  const { data: count } = useSWR<number>(ONLINE_COUNT_KEY, null);
  const { data: connected } = useSWR<boolean>(ONLINE_CONNECTED_KEY, null);

  return { count, connected: connected ?? false };
}
