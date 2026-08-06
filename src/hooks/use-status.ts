"use client";

import { useSyncExternalStore } from "react";
import useSWR from "swr";

import type { StatusResponse } from "@/lib/types";

function subscribeVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

/** 页面不可见时暂停轮询 —— 后台标签页没必要每秒打一次充电头 */
export function usePageActive() {
  return useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState === "visible",
    () => true,
  );
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
 */
export function useStatus<T>(path: string, refreshInterval: number): StatusState<T> {
  const active = usePageActive();

  const { data, error, isLoading } = useSWR<StatusResponse<T>>(path, fetcher<T>, {
    refreshInterval: active ? refreshInterval : 0,
    revalidateOnFocus: true,
    keepPreviousData: true,
    // 上游本来就会返回降级信封，重试意义不大，交给下一次轮询
    shouldRetryOnError: false,
  });

  return {
    data: data?.ok ? data.data : undefined,
    error: data && !data.ok ? data.error : error ? String(error.message ?? error) : undefined,
    isLoading,
  };
}
