"use client";

import { useSyncExternalStore } from "react";
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
 * refreshInterval 由调用方按当前状态给：有正在播放/正在充电的东西就调快，
 * 空闲时调慢。真正打到上游的频率由服务端各自的缓存 TTL 决定，前端调快
 * 不会等比传导过去。
 */
export function useStatus<T>(
  path: string,
  /** 传函数可以按当前数据动态决定间隔，比如「有东西在播就调快」 */
  refreshInterval: number | ((data: T | undefined) => number),
): StatusState<T> {
  const active = usePageActive();

  const interval = (envelope: StatusResponse<T> | undefined) => {
    if (!active) return 0;
    if (typeof refreshInterval === "number") return refreshInterval;
    return refreshInterval(envelope?.ok ? envelope.data : undefined);
  };

  const { data, error, isLoading } = useSWR<StatusResponse<T>>(path, fetcher<T>, {
    refreshInterval: interval,
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
