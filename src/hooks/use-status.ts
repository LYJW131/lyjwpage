"use client";

import { useEffect, useSyncExternalStore } from "react";
import useSWR from "swr";

import type { StatusResponse } from "@/lib/types";

function subscribeVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

/** 页面不可见时暂停轮询 —— 后台标签页没必要一直取数 */
export function usePageActive() {
  return useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState === "visible",
    () => true,
  );
}

/**
 * 全页共用一条 SSE 连接。
 *
 * 三张卡片各自建一条就是三倍连接数，而服务端推的本来就是「哪一路变了」
 * 这个广播信号，一条连接分发给所有订阅者即可。
 */
const listeners = new Map<string, Set<() => void>>();
let source: EventSource | null = null;

function ensureSource() {
  if (source || typeof window === "undefined") return;
  source = new EventSource("/api/events");
  source.addEventListener("status", (event) => {
    try {
      const { channel } = JSON.parse((event as MessageEvent).data) as { channel: string };
      listeners.get(channel)?.forEach((fn) => fn());
    } catch {
      // 坏消息忽略，EventSource 自己会继续收下一条
    }
  });
  // 断线时 EventSource 会按 retry 自动重连，这里不用做别的
}

function onStatusEvent(channel: string, handler: () => void) {
  ensureSource();
  const set = listeners.get(channel) ?? new Set();
  set.add(handler);
  listeners.set(channel, set);
  return () => {
    set.delete(handler);
  };
}

async function fetcher<T>(url: string): Promise<StatusResponse<T>> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`请求 ${url} 失败：${response.status}`);
  return response.json();
}

export type StatusState<T> = {
  data: T | undefined;
  /** 上游报错 —— 注意这与「还在加载」是两回事 */
  error: string | undefined;
  isLoading: boolean;
};

/**
 * 统一的状态数据 hook。
 *
 * 路由返回的信封里 ok:false 也是 200，所以这里把它翻译成 error，
 * 让「上游挂了」和「网络请求失败」走同一条渲染分支。
 *
 * 数据更新以 SSE 为主：后端收到推送就广播，这里立刻重取。轮询退化成兜底，
 * 防止 SSE 断了而重连又没成功时页面一直停在旧数据上，所以间隔可以放很宽。
 */
export function useStatus<T>(
  path: string,
  refreshInterval: number,
  channel?: string,
): StatusState<T> {
  const active = usePageActive();

  const { data, error, isLoading, mutate } = useSWR<StatusResponse<T>>(path, fetcher<T>, {
    refreshInterval: active ? refreshInterval : 0,
    revalidateOnFocus: true,
    keepPreviousData: true,
    // 上游本来就会返回降级信封，重试意义不大，交给下一次轮询
    shouldRetryOnError: false,
  });

  useEffect(() => {
    if (!channel) return;
    return onStatusEvent(channel, () => {
      void mutate();
    });
  }, [channel, mutate]);

  return {
    data: data?.ok ? data.data : undefined,
    error: data && !data.ok ? data.error : error ? String(error.message ?? error) : undefined,
    isLoading,
  };
}
