"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import useSWR, { useSWRConfig } from "swr";

import { fetchStatus, guardPolled, withoutServedAt } from "@/lib/status-reads";
import { useLiveSocketConnected } from "@/hooks/use-live-events";
import { fallbackOutlived, lagOverdue, nextLagDelay, realtimeInterval } from "@/lib/poll-schedule";
import { createMountRefetchGate, createRefetchLedger } from "@/lib/refetch-guard";
import { cadenceOfPath, layerOfPath, pushCoversPath } from "@/lib/status-views";
import type { StatusResponse } from "@/lib/types";

function subscribeVisibility(onChange: () => void) {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

export function usePageActive() {
  return useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState === "visible",
    () => true,
  );
}

export const statusFetcher = fetchStatus;
const fetcher = statusFetcher;

const refetchLedger = createRefetchLedger();
const mountRefetchGate = createMountRefetchGate();

// since 只进请求地址，不能进 SWR 键，否则每轮都会重建资源和计时器。
export function incrementalFetcher<T>(
  cursor: () => string | number | null,
  merge: (data: T) => T,
): (path: string) => Promise<StatusResponse<T>> {
  return async (path) => {
    const since = cursor();
    const envelope = await fetcher<T>(since == null ? path : `${path}?since=${since}`);
    return envelope.ok ? { ...envelope, data: merge(envelope.data) } : envelope;
  };
}

export type StatusState<T> = {
  data: T | undefined;
  updatedAt: number | undefined;
  error: string | undefined;
  isLoading: boolean;
  isValidating: boolean;
  servedAt: number | undefined;
};

export type StatusOptions<T> = {
  fallback: StatusResponse<T>;
  fetcher?: (path: string) => Promise<StatusResponse<T>>;
  // fallbackData 不会初始化增量游标；此 layout effect 必须先于 useSWR 的挂载校验。
  seedFallback?: (data: T) => void;
  revalidateOnMount?: boolean;
  revalidateOnFocus?: boolean;
};

export type RefreshInterval<T> = number | ((data: T | undefined) => number);

export function useStatus<T>(path: string, options: StatusOptions<T>): StatusState<T>;
export function useStatus<T>(path: string, refreshInterval: RefreshInterval<T>, options: StatusOptions<T>): StatusState<T>;
export function useStatus<T>(
  path: string,
  intervalOrOptions: RefreshInterval<T> | StatusOptions<T>,
  maybeOptions?: StatusOptions<T>,
): StatusState<T> {
  const refreshInterval: RefreshInterval<T> | undefined =
    typeof intervalOrOptions === "object" ? undefined : intervalOrOptions;
  const {
    fallback,
    fetcher: customFetcher,
    seedFallback,
    revalidateOnMount,
    revalidateOnFocus,
  } = (typeof intervalOrOptions === "object" ? intervalOrOptions : maybeOptions) as StatusOptions<T>;
  const active = usePageActive();
  const socketConnected = useLiveSocketConnected();
  const lag = layerOfPath(path) === "lag";
  const cadenceMs = lag ? cadenceOfPath(path) : undefined;
  const pushCovers = pushCoversPath(path);
  if (process.env.NODE_ENV !== "production" && lag === (refreshInterval !== undefined)) {
    throw new Error(`useStatus("${path}"): lag views take their cadence from lib/status-views; realtime views need an interval`);
  }
  const refreshIntervalRef = useRef(refreshInterval);
  useEffect(() => {
    refreshIntervalRef.current = refreshInterval;
  }, [refreshInterval]);
  const fallbackRef = useRef(fallback);
  useEffect(() => {
    fallbackRef.current = fallback;
  }, [fallback]);

  // SWR 不会因其他回源更新自动重排轮询；锚变化须改变 interval 引用。
  const [lagAnchor, setLagAnchor] = useState<number | undefined>(() => (fallback.ok ? fallback.updatedAt : undefined));

  // UI 重渲染不能改变 interval 引用，否则 SWR 会不断重置计时器。
  const interval = useCallback(
    (envelope: StatusResponse<T> | undefined) => {
      if (!active) return 0;
      const current = envelope ?? fallbackRef.current;
      if (lag) {
        if (!cadenceMs) return 0;
        return nextLagDelay(current.ok ? current.updatedAt : undefined, cadenceMs, Date.now());
      }
      const latestInterval = refreshIntervalRef.current ?? 0;
      const cardMs = typeof latestInterval === "number" ? latestInterval : latestInterval(current?.ok ? current.data : undefined);
      return realtimeInterval(cardMs, socketConnected, pushCovers);
    },
    // lagAnchor 仅用于触发计时器重排。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, lag, cadenceMs, socketConnected, pushCovers, lagAnchor],
  );

  useLayoutEffect(() => {
    if (fallback.ok) seedFallback?.(fallback.data);
  }, [fallback, seedFallback]);

  const { mutate: revalidateKey } = useSWRConfig();

  // SWR 在微任务中处理结果，补取检查须排到后续宏任务才能读到结账状态。
  const guarded = useCallback(
    async (key: string) => {
      const seq = refetchLedger.begin(key);
      try {
        return guardPolled(key, await (customFetcher ?? fetcher<T>)(key));
      } finally {
        refetchLedger.end(key, seq);
        setTimeout(() => {
          if (refetchLedger.settle(key)) void revalidateKey(key);
        }, 0);
      }
    },
    [customFetcher, revalidateKey],
  );

  // servedAt 只给首帧时钟；留在 SWR 会令挂载校验永远深比较不等。
  const fallbackData = useMemo(() => withoutServedAt(fallback), [fallback]);

  // 被推送丢弃的回源需要补取，但须等同键全部请求结束，避免多个消费者互相丢弃并无限重试。
  const onDiscarded = useCallback((key: string) => refetchLedger.discarded(key), []);
  const onSuccess = useCallback((_data: unknown, key: string) => refetchLedger.accepted(key), []);
  const { data, error, isLoading, isValidating, mutate } = useSWR<StatusResponse<T>>(path, guarded, {
    onDiscarded,
    onSuccess,
    fallbackData,
    revalidateOnMount: fallback.ok && (revalidateOnMount === false || lag) ? false : undefined,
    refreshInterval: interval,
    // SWR 内置可见性判断可能与应用内浏览器不一致，统一由 usePageActive 决定暂停。
    refreshWhenHidden: true,
    refreshWhenOffline: true,
    revalidateOnFocus: revalidateOnFocus !== false,
    keepPreviousData: true,
    shouldRetryOnError: false,
  });

  const currentUpdatedAt = lag && data?.ok ? data.updatedAt : undefined;
  if (lag && currentUpdatedAt !== undefined && currentUpdatedAt !== lagAnchor) setLagAnchor(currentUpdatedAt);

  const mountFallback = useRef(fallback);
  const mountChecked = useRef(false);
  useEffect(() => {
    const initial = mountFallback.current;
    if (mountChecked.current) return;
    mountChecked.current = true;
    if (!initial.ok) return;
    const now = Date.now();
    if (lag) {
      if (!cadenceMs || revalidateOnMount === false || !lagOverdue(initial.updatedAt, cadenceMs, now)) return;
    } else {
      const cardMs = refreshIntervalRef.current;
      if (revalidateOnMount !== false || typeof cardMs !== "number" || cardMs <= 0) return;
      if (!fallbackOutlived(initial.servedAt, cardMs, now)) return;
    }
    if (mountRefetchGate.claim(path, now)) void mutate();
  }, [lag, cadenceMs, revalidateOnMount, mutate, path]);

  return {
    data: data?.ok ? data.data : undefined,
    updatedAt: data?.ok ? data.updatedAt : undefined,
    error: data && !data.ok ? data.error : error ? String(error.message ?? error) : undefined,
    isLoading,
    isValidating,
    servedAt: fallback.ok ? fallback.servedAt : undefined,
  };
}

// revalidate:false 的推送不会重算 SWR 轮询间隔，到期重取必须另排一次性定时器。
export function useExpiryRefetch(path: string, expiresInMs: number | null | undefined) {
  const { mutate } = useSWRConfig();
  useEffect(() => {
    if (expiresInMs == null) return;
    const timer = setTimeout(
      () => void mutate(path),
      Math.max(250, expiresInMs + 250),
    );
    return () => clearTimeout(timer);
  }, [path, expiresInMs, mutate]);
}
