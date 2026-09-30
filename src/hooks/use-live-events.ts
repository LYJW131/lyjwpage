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

const FORWARDS: ReadonlyArray<{
  event: LiveEvent["type"];
  merge?: (data: unknown) => unknown | null;
  refetch?: (key: string) => boolean;
}> = [
  { event: "desktop" },
  { event: "listening-now" },
  { event: "watching-now" },
  { event: "listening" },
  { event: "watching" },
  { event: "playing-now" },
  { event: "quest-now" },
  { event: "playing" },
  {
    event: "trophies",
    refetch: (key) => key.startsWith(`${TROPHIES_PATH}?`),
  },
  {
    event: "charger",
    merge: (data) => mergeChargerHistory(data as ChargerPayload),
  },
  { event: "powerbank" },
  { event: "coding-now" },
];

const PRESENCE_PATHS = [
  DESKTOP_PATH,
  NOW_LISTENING_PATH,
  CHARGER_PATH,
  POWERBANK_PATH,
  CODING_NOW_PATH,
];

const INVALIDATIONS: ReadonlyArray<{
  event: LiveEvent["type"];
  paths: readonly string[];
}> = [
  { event: "presence", paths: PRESENCE_PATHS },
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

type Incoming = { type: LiveEvent["type"]; payload: unknown };

export const ONLINE_COUNT_KEY = "worker:online-count";
export const ONLINE_CONNECTED_KEY = "worker:online-connected";

function dispatch(mutate: ScopedMutator, message: Incoming): void {
  if (message.type === "online") {
    const online = (message.payload as { online?: unknown } | null)?.online;
    if (typeof online === "number") void mutate(ONLINE_COUNT_KEY, online, { revalidate: false });
    return;
  }

  const forward = FORWARD_BY_EVENT.get(message.type);
  if (forward) {
    const data = forward.merge ? forward.merge(message.payload) : message.payload;
    if (data == null) return;
    const envelope: StatusResponse<unknown> = { ok: true, data };
    // 先登记写入代次，阻止在途旧轮询和乱序推送覆盖新值。
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

let socket: WebSocket | null = null;
let refCount = 0;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
let retryAttempts = 0;
let activeMutate: ScopedMutator | null = null;
let reportedVisible: boolean | null = null;

let connected = false;
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

export function useLiveSocketConnected(): boolean {
  return useSyncExternalStore(subscribeConnection, () => connected, () => false);
}

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
  // 先摘监听再关闭，避免主动 close 排出一次重连。
  socket.onopen = null;
  socket.onmessage = null;
  socket.onclose = null;
  socket.onerror = null;
  try {
    socket.close();
  } catch {}
  socket = null;
}

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

// 交接处理器必须同步完成，排队消息派发时才能读到新 handler。
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
  if (!base || typeof window === "undefined") return;

  const early = adoptEarlySocket();
  let ws: WebSocket;
  if (early) {
    ws = early.socket;
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

  // 预连 socket 可能早已发过 open，接管后须主动执行就绪逻辑。
  const onReady = () => {
    retryAttempts = 0;
    const reconnect = everConnected;
    everConnected = true;
    setConnected(true);
    if (reconnect) void mutate((key) => typeof key === "string" && isRealtimeViewPath(key));
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
    try {
      ws.close();
    } catch {}
  };

  ws.onclose = () => {
    teardown();
    setConnected(false);
    if (refCount <= 0) return;
    const delay = Math.min(1_000 * Math.pow(1.5, retryAttempts), MAX_BACKOFF_MS);
    retryAttempts += 1;
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      if (refCount > 0) open(mutate);
    }, delay);
  };

  if (ws.readyState === WebSocket.OPEN) onReady();
  else ws.onopen = onReady;

  // 装好 handler 后同步重放旧消息，确保排队的新消息不会抢先。
  if (early) for (const raw of early.queue) receive(mutate, raw);
}

function close(): void {
  retryAttempts = 0;
  teardown();
  setConnected(false);
}

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

// Safari 从 bfcache 恢复可能只发 pageshow，不发 visibilitychange。
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
