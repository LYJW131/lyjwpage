"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
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
 * refreshInterval 由调用方按当前状态给：有播放中/正在充电的东西就调快，
 * 空闲时调慢。真正打到上游的频率由服务端各自的缓存 TTL 决定，前端调快
 * 不会等比传导过去。
 */
export function useStatus<T>(
  path: string,
  /** 传函数可以按当前数据动态决定间隔，比如「有东西在播就调快」 */
  refreshInterval: number | ((data: T | undefined) => number),
  /**
   * 自定义取数。给需要增量拉取的接口用（充电头曲线就是）：SWR 的缓存键必须
   * 保持是 path，不能把 ?since= 拼进去 —— 那样每轮都是新资源，去重、
   * keepPreviousData、轮询计时器全部失效。所以变化的部分藏在 fetcher 里。
   * 必须是稳定引用，否则 SWR 每次渲染都会重新取。
   */
  customFetcher?: (path: string) => Promise<StatusResponse<T>>,
): StatusState<T> {
  const active = usePageActive();
  const refreshIntervalRef = useRef(refreshInterval);
  useEffect(() => {
    refreshIntervalRef.current = refreshInterval;
  }, [refreshInterval]);

  // SWR 会在 refreshInterval 函数引用变化时重置计时器。调用组件可能因为
  // 播放进度等 UI 每秒重渲染，所以这里只让函数在可见性变化时才换引用。
  const interval = useCallback(
    (envelope: StatusResponse<T> | undefined) => {
      if (!active) return 0;
      const latestInterval = refreshIntervalRef.current;
      if (typeof latestInterval === "number") return latestInterval;
      return latestInterval(envelope?.ok ? envelope.data : undefined);
    },
    [active],
  );

  const { data, error, isLoading } = useSWR<StatusResponse<T>>(path, customFetcher ?? fetcher<T>, {
    refreshInterval: interval,
    // 是否暂停由上面的 usePageActive 统一决定，避免 SWR 内置的可见性/在线
    // 判定与应用内浏览器状态不一致，导致首次请求后再也不轮询。
    refreshWhenHidden: true,
    refreshWhenOffline: true,
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
