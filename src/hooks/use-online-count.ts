"use client";

import { useEffect } from "react";
import useSWR, { useSWRConfig } from "swr";
import type { ScopedMutator } from "swr";

export const ONLINE_COUNT_KEY = "worker:online-count";
export const ONLINE_CONNECTED_KEY = "worker:online-connected";

function getOnlineWsUrl(): string | null {
  const url = process.env.NEXT_PUBLIC_ONLINE_WS_URL?.trim();
  return url || null;
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

function handlePageHide() {
  cleanupSocket();
  if (activeMutate) {
    void activeMutate(ONLINE_CONNECTED_KEY, false, { revalidate: false });
  }
}

export function subscribeOnlineCount(mutate: ScopedMutator): () => void {
  activeMutate = mutate;
  refCount += 1;

  if (!isListenersAttached && typeof document !== "undefined" && typeof window !== "undefined") {
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("pagehide", handlePageHide);
    window.addEventListener("beforeunload", handlePageHide);
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
        window.removeEventListener("beforeunload", handlePageHide);
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
