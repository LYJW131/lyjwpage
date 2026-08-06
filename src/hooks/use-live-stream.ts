"use client";

import { useEffect, useSyncExternalStore } from "react";
import { useSWRConfig } from "swr";
import type { ScopedMutator } from "swr";

import type { ActivityPayload, StatusResponse } from "@/lib/types";

const STREAM_PATH = "/api/status/stream";
/** SWR 的缓存键就是请求路径，推送写进来的必须和轮询用的是同一个 */
export const ACTIVITY_PATH = "/api/status/activity";

/**
 * 整页共用一条 SSE 连接。
 *
 * 现在有多个组件要读活动状态（Live Desk 的前台应用、Recently Played 的本机
 * 播放），如果每个都自己 new 一个 EventSource，一个页面就会占掉好几条长连接。
 * 所以连接做成模块级单例，按订阅者数量开关。
 */
let source: EventSource | null = null;
let refCount = 0;
let connected = false;
const listeners = new Set<() => void>();

function setConnected(value: boolean) {
  if (connected === value) return;
  connected = value;
  for (const listener of listeners) listener();
}

function subscribeConnected(onChange: () => void) {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function open(mutate: ScopedMutator) {
  if (source) return;
  const next = new EventSource(STREAM_PATH);
  source = next;

  // EventSource 自带指数退避重连，这里只需要如实反映当前状态
  next.onopen = () => setConnected(true);
  next.onerror = () => setConnected(false);

  next.addEventListener("activity", (event) => {
    const envelope: StatusResponse<ActivityPayload> = {
      ok: true,
      data: JSON.parse(event.data) as ActivityPayload,
      fetchedAt: new Date().toISOString(),
    };
    // revalidate: false —— 推来的就是最新的，没必要再回源确认一次
    void mutate(ACTIVITY_PATH, envelope, { revalidate: false });
  });
}

function close() {
  source?.close();
  source = null;
  setConnected(false);
}

/**
 * 订阅服务端推送。
 *
 * 推来的活动状态直接写进 SWR 缓存，所以组件那边照旧用 useStatus 读，
 * 不用管数据是推来的还是轮询来的。轮询作为兜底保留 —— 长连接被中间代理
 * 掐断是迟早的事，`connected` 就是给调用方用来在断开时把轮询调快的。
 *
 * 不随页面可见性断开：连接闲置时只有 15 秒一次的心跳，成本远低于反复重连。
 */
export function useLiveStream() {
  const { mutate } = useSWRConfig();
  // 连接状态是个外部 store，交给 useSyncExternalStore 订阅比自己 setState 干净，
  // 服务端快照恒为 false（那边根本没有 EventSource）
  const isConnected = useSyncExternalStore(
    subscribeConnected,
    () => connected,
    () => false,
  );

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

  return { connected: isConnected };
}
