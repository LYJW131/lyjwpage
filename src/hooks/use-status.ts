"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import useSWR, { useSWRConfig } from "swr";

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

/**
 * 增量拉取的取数壳子。
 *
 * 曲线类的接口（充电头功率、vibe coding 活动）每轮只问服务端要游标之后的新
 * 点，本地拼成完整序列。两张卡从前各写了一遍一模一样的「算游标 → 拼 URL →
 * fetch → 检查 ok → 合并」，连错误文案都是复制的。
 *
 * 关键是 SWR 的缓存键必须保持是 path，不能把 `?since=` 拼进去 —— 那样每轮都
 * 是一个新资源，去重、keepPreviousData、轮询计时器会全部失效。所以变化的部分
 * 藏在这里面，外面看到的始终是同一个键。
 *
 * `cursor` 和 `merge` 都取模块级函数（charger-history / vibecoding-activity），
 * 所以这个壳子可以在模块作用域构造好、天然是稳定引用，调用方不需要 useCallback。
 */
export function incrementalFetcher<T>(
  cursor: () => number | null,
  merge: (data: T) => T,
): (path: string) => Promise<StatusResponse<T>> {
  return async (path) => {
    const since = cursor();
    const envelope = await fetcher<T>(since == null ? path : `${path}?since=${since}`);
    // 降级信封原样透出，别往合并器里塞 —— 它手上没有 data
    return envelope.ok ? { ...envelope, data: merge(envelope.data) } : envelope;
  };
}

export type StatusState<T> = {
  data: T | undefined;
  /** 上游报错 —— 注意这与「还在加载」是两回事 */
  error: string | undefined;
  isLoading: boolean;
  isValidating: boolean;
};

export type StatusOptions<T> = {
  /**
   * 服务端渲染时取好的信封，当 SWR 的 fallbackData —— 首屏 HTML 自带数据，
   * 没有骨架期。由 app/page.tsx 直接调 lib 里的取数函数拿到，见那边。
   */
  fallback: StatusResponse<T>;
  /**
   * 自定义取数。增量拉取的接口用 incrementalFetcher 造一个传进来。
   * 必须是稳定引用，否则 SWR 每次渲染都会重新取。
   */
  fetcher?: (path: string) => Promise<StatusResponse<T>>;
  /**
   * 把服务端传来的完整快照灌进增量 fetcher 的客户端累加器。
   *
   * fallbackData 只会初始化 SWR 缓存，不会自动初始化 fetcher 自己维护的游标。
   * 不接这一步的话，曲线虽已在首屏 HTML 里，挂载校验仍会因为游标为空再拉一遍
   * 全量。layout effect 必须排在下面的 useSWR 之前：SWR 也在 layout effect 里注册
   * 挂载校验，这样它第一次调用 fetcher 时已经能从 SSR 末点开始增量拉。
   */
  seedFallback?: (data: T) => void;
  /**
   * 挂载时要不要立刻回源一次。默认要。
   *
   * 「此刻」类的信封里有服务端按当时的时钟算出来的结论（在不在线、陈没陈旧、
   * 宽限期还剩多久），HTML 在浏览器手上放一会儿就不成立了；Pusher 连上之前的
   * 那段空窗里发生的事也只能靠这一次补回来。
   *
   * 只有列表类该关掉 —— 内容不会随时间自己变质，首屏那份就是最新的，
   * 那一次请求是纯粹省得掉的。
   */
  revalidateOnMount?: boolean;
};

/**
 * 统一的状态数据 hook。
 *
 * 路由返回的信封里 ok:false 也是 200，所以这里把它翻译成 error，
 * 让「上游挂了」和「网络请求失败」走同一条渲染分支。
 *
 * refreshInterval 由调用方按当前状态给：有播放中/正在充电的东西就调快，
 * 空闲时调慢。真正打到 Redis 的频率由服务端快照缓存决定，前端调快
 * 不会等比传导过去。
 */
export function useStatus<T>(
  path: string,
  /** 传函数可以按当前数据动态决定间隔，比如「有东西在播就调快」 */
  refreshInterval: number | ((data: T | undefined) => number),
  { fallback, fetcher: customFetcher, seedFallback, revalidateOnMount }: StatusOptions<T>,
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

  useLayoutEffect(() => {
    if (fallback.ok) seedFallback?.(fallback.data);
  }, [fallback, seedFallback]);

  const { data, error, isLoading, isValidating } = useSWR<StatusResponse<T>>(path, customFetcher ?? fetcher<T>, {
    fallbackData: fallback,
    /**
     * SWR 的默认是「有 fallbackData 也照样在挂载时回源」—— revalidateIfStale
     * 默认 true，它判的是 `isUndefined(data) || revalidateIfStale`。要真省掉
     * 首屏那次请求，只能显式关掉。
     *
     * 服务端那一路当时就挂了的话不关：降级信封得靠挂载这一次去纠正，
     * 不然一张卡会顶着「未连接」等满一个轮询周期。
     */
    revalidateOnMount: revalidateOnMount === false && fallback.ok ? false : undefined,
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
    isValidating,
  };
}

/**
 * payload 自己说了「多久之后就不成立」时，把一次重取排在那一刻。
 *
 * 有些结论会光靠时间流逝失效 —— 当前只有播放来源的暂停宽限期（见
 * getNowListening 的 expiresInMs）。那个到期时刻不对应任何一次上报，
 * 服务端不会为它推送，也不该为它挂定时器：serverless 上响应一返回实例就冻结，
 * 挂了也不执行。
 *
 * 为什么不复用 useStatus 的 refreshInterval（它本来就能按数据动态给间隔）：
 * SWR 只在**真的取过一次数**之后才重算那个间隔，而推送走的是
 * `mutate(path, envelope, { revalidate: false })` —— 直接写缓存、不发请求，
 * 于是间隔根本不会被重算。偏偏「暂停」这件事几乎总是推来的，正好落在那条
 * 够不着的路径上。所以这里单独排一个一次性定时器，推来的还是轮询来的都管用。
 */
export function useExpiryRefetch(path: string, expiresInMs: number | null | undefined) {
  const { mutate } = useSWRConfig();
  useEffect(() => {
    if (expiresInMs == null) return;
    const timer = setTimeout(
      () => void mutate(path),
      // 多等 250ms：到期时刻在服务端是绝对的，早问一下只会拿回同一份还没过期的
      Math.max(250, expiresInMs + 250),
    );
    return () => clearTimeout(timer);
  }, [path, expiresInMs, mutate]);
}
