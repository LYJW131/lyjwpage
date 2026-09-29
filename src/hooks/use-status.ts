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

/** 页面不可见时暂停轮询 —— 后台标签页没必要一直取数 */
export function usePageActive() {
  return useSyncExternalStore(
    subscribeVisibility,
    () => document.visibilityState === "visible",
    () => true,
  );
}

/** 各卡直连自己的端点，见 lib/status-reads */
export const statusFetcher = fetchStatus;
const fetcher = statusFetcher;

/**
 * 同一个键有多个消费者时，回源别互相顶掉、再各自重问成无限循环，也别漏掉该补的那一次。
 * 为什么、怎么防，见 lib/refetch-guard。两本账都是整页共享的（模块级）：浏览器里一个页面
 * 一份，服务端渲染不会碰到（回源与挂载补取都只在浏览器里发生）。
 */
const refetchLedger = createRefetchLedger();
const mountRefetchGate = createMountRefetchGate();

/**
 * 增量拉取的取数壳子。
 *
 * 充电头功率和 GitHub 热力图每轮只问服务端要游标之后的新点，本地拼成完整
 * 序列。关键是 SWR 的缓存键必须保持是 path，不能把 `?since=` 拼进去 —— 那样
 * 每轮都是一个新资源，去重、keepPreviousData、轮询计时器会全部失效。所以变化
 * 的部分藏在这里面，外面看到的始终是同一个键。
 *
 * `cursor` 和 `merge` 都取模块级函数，所以这个壳子可以在模块作用域构造好、
 * 天然是稳定引用，调用方不需要 useCallback。游标是毫秒时间戳或 YYYY-MM-DD。
 */
export function incrementalFetcher<T>(
  cursor: () => string | number | null,
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
  /** 可滞后层写入方最后一次成功取到这份数据的时刻；实时层没有 */
  updatedAt: number | undefined;
  /** 上游报错 —— 注意这与「还在加载」是两回事 */
  error: string | undefined;
  isLoading: boolean;
  isValidating: boolean;
  /**
   * 首屏那份信封（fallback）的出站时刻：源站交出它的那一刻，跟着首屏缓存一起冻住。
   * 首帧没有访客钟，按时间判过期的 hook 拿它当钟（见 hooks/use-stale），服务端
   * 预渲染和 hydrate 读到的是同一个值。之后取回的信封不带它（lib/status-reads 的
   * fetchStatus 会摘掉），挂载后一律用浏览器自己的钟。
   */
  servedAt: number | undefined;
};

export type StatusOptions<T> = {
  /**
   * 服务端渲染时取好的信封，当 SWR 的 fallbackData —— 首屏 HTML 自带数据，
   * 没有骨架期。由 app/page.tsx 经 lib/first-screen 的 firstScreen 拿到：那是一次
   * HTTP 读，读的是 Worker 上这张卡自己的端点，不在站点进程里直接跑取数函数。
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
   * 挂载时要不要立刻回源一次。不传时按数据层（lib/status-views 的 layer）定：
   *
   * - 实时层：要。HTML 生成后到推送连上之间的空窗里发生的事只能靠这一次补回来。
   * - 可滞后层：首屏那份还没过下一次预期写入（`updatedAt + cadenceMs + 宽限`）就不
   *   回源，直接用它、到那一刻再取；HTML 放久了（没人访问时首页可能几个小时没重建）
   *   才在挂载后补取一次。
   *
   * 显式传 false 的实时视图（年度热力图）不跟着挂载回源，只在首屏那份的出站时刻（`servedAt`）
   * 比一个轮询间隔还早时补取一次（lib/poll-schedule 的 fallbackOutlived）：首屏 HTML 可以在
   * 缓存里放好几个小时，这类视图又没有推送和失效来纠正它。
   */
  revalidateOnMount?: boolean;
  /**
   * 窗口重新获得焦点时要不要回源。默认要。
   *
   * 进页时浏览器会响一次 focus / visibility，光关 revalidateOnMount 挡不住
   * 这一下。只有确实不想为切回标签付一次请求时才关。
   */
  revalidateOnFocus?: boolean;
};

/** 卡片给的轮询间隔：传函数可以按当前数据动态决定，比如「有东西在播就调快」 */
export type RefreshInterval<T> = number | ((data: T | undefined) => number);

/**
 * 统一的状态数据 hook。
 *
 * 路由返回的信封里 ok:false 也是 200，所以这里把它翻译成 error，
 * 让「上游挂了」和「网络请求失败」走同一条渲染分支。
 *
 * 轮询节奏（纯函数在 lib/poll-schedule）：
 *
 * - 可滞后层：不传间隔，`useStatus(path, options)`。下一次取排在登记表
 *   （lib/status-views 的 `cadenceMs`）算出的下一次预期写入之后，改节奏只改登记表。
 * - 实时层：`useStatus(path, interval, options)`，间隔由调用方按当前状态给（有播放中 /
 *   正在充电的东西就调快）。推送连着且该视图 `pushCovers` 时退成兜底轮询
 *   （`PUSH_SAFETY_NET_MS`），断开时用这里给的间隔。
 */
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

  /**
   * 可滞后层排期的锚：手上那份的 `updatedAt`。SWR 只在自己的计时器触发时才重算间隔，
   * 挂载补取、切回焦点这类回源拿回的新 `updatedAt` 不会重排已经挂着的计时器；
   * 让锚进下面 interval 的依赖，一变就换引用，SWR 按新数据重排。
   */
  const [lagAnchor, setLagAnchor] = useState<number | undefined>(() => (fallback.ok ? fallback.updatedAt : undefined));

  // SWR 会在 refreshInterval 函数引用变化时重置计时器。调用组件可能因为
  // 播放进度等 UI 每秒重渲染，所以这里只让函数在可见性、推送连接、可滞后层的
  // 锚变化时才换引用。连接一变计时器就按新间隔重排：断开时立刻回到快间隔。
  const interval = useCallback(
    (envelope: StatusResponse<T> | undefined) => {
      if (!active) return 0;
      // 挂载时 SWR 缓存里还没有 fallbackData，拿首屏那份的 updatedAt 排第一次
      const current = envelope ?? fallbackRef.current;
      if (lag) {
        if (!cadenceMs) return 0;
        return nextLagDelay(current.ok ? current.updatedAt : undefined, cadenceMs, Date.now());
      }
      const latestInterval = refreshIntervalRef.current ?? 0;
      const cardMs = typeof latestInterval === "number" ? latestInterval : latestInterval(current?.ok ? current.data : undefined);
      return realtimeInterval(cardMs, socketConnected, pushCovers);
    },
    // lagAnchor 不在函数体里读，只用来换引用、让 SWR 重排计时器
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [active, lag, cadenceMs, socketConnected, pushCovers, lagAnchor],
  );

  useLayoutEffect(() => {
    if (fallback.ok) seedFallback?.(fallback.data);
  }, [fallback, seedFallback]);

  const { mutate: revalidateKey } = useSWRConfig();

  /**
   * 取回来的这份要是比推来的旧，就换回推来的那份。
   *
   * 包在最外面而不是塞进 fetcher 里：增量拉取那条的请求地址带着 `?since=`，
   * 和 SWR 的键不是一个字符串，而这里认的是键。为什么要挡见 lib/status-reads。
   *
   * 同时给这个键上的回源记账（lib/refetch-guard）：结束时先出账、再排一个宏任务看有没有
   * 欠着的补取。结果处理（被接受还是被丢弃）是 SWR 在紧接着的微任务里做完的，宏任务排在
   * 它后面，所以看到的是判完之后的账。失败、页面已卸载才回来的请求也走这里，账都会结清。
   */
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

  /**
   * 首屏那份的 servedAt 只给首帧的钟用（返回值里单独给），不进 SWR：留着的话挂载
   * 校验取回的那份永远和它深比较不等，每张实时卡挂载时都白白重渲染一次。
   */
  const fallbackData = useMemo(() => withoutServedAt(fallback), [fallback]);

  /**
   * 回源途中来了一条推送：SWR 会把这次回源的结果整份丢掉（它认推送写进缓存的那一刻
   * 比请求新），isValidating 照样落下。推来的若是整份，丢了无妨；若只是局部补丁
   * （只改几个字段、不带时间戳），缓存里的时间戳就还是回源之前那份，按钟判出的过期
   * 会被当成「回源回来了还是过期」确认掉。被丢了就再问一次。
   *
   * 但「被丢」还有另一种：被同一个键上另一条更晚发出的回源顶掉。那一条还在路上、
   * 结果照样会落地，这时立刻再问不但多余，还会把那一条顶成被丢弃、让它也再问 ——
   * 两个消费者共用一个键时就是无限接力。所以这里只记账（欠一次补取），等这个键上所有
   * 回源都结束之后统一补一次：更晚的那条落地了就免了，它失败了才补（lib/refetch-guard）。
   */
  const onDiscarded = useCallback((key: string) => refetchLedger.discarded(key), []);
  const onSuccess = useCallback((_data: unknown, key: string) => refetchLedger.accepted(key), []);
  const { data, error, isLoading, isValidating, mutate } = useSWR<StatusResponse<T>>(path, guarded, {
    onDiscarded,
    onSuccess,
    fallbackData,
    /**
     * SWR 的默认是「有 fallbackData 也照样在挂载时回源」—— revalidateIfStale
     * 默认 true，它判的是 `isUndefined(data) || revalidateIfStale`。要真省掉
     * 首屏那次请求，只能显式关掉。
     *
     * 服务端那一路当时就挂了的话不关：降级信封得靠挂载这一次去纠正，
     * 不然一张卡会顶着「未连接」等满一个轮询周期。
     */
    revalidateOnMount: fallback.ok && (revalidateOnMount === false || lag) ? false : undefined,
    refreshInterval: interval,
    // 是否暂停由上面的 usePageActive 统一决定，避免 SWR 内置的可见性/在线
    // 判定与应用内浏览器状态不一致，导致首次请求后再也不轮询。
    refreshWhenHidden: true,
    refreshWhenOffline: true,
    revalidateOnFocus: revalidateOnFocus !== false,
    keepPreviousData: true,
    // 上游本来就会返回降级信封，重试意义不大，交给下一次轮询
    shouldRetryOnError: false,
  });

  const currentUpdatedAt = lag && data?.ok ? data.updatedAt : undefined;
  // 渲染期就地对齐（同 hooks/use-stale 的做法），不放进 effect
  if (lag && currentUpdatedAt !== undefined && currentUpdatedAt !== lagAnchor) setLagAnchor(currentUpdatedAt);

  /**
   * 首屏那份太旧时的补取：可滞后层比 `updatedAt` 与写入节奏，关了挂载回源的实时视图比
   * `servedAt` 与轮询间隔（见上面 revalidateOnMount）。放在 effect 里：要拿此刻的钟去比，
   * 渲染期间不读钟。只看挂载那一刻的首屏信封，之后交给轮询。
   */
  const mountFallback = useRef(fallback);
  const mountChecked = useRef(false);
  useEffect(() => {
    const initial = mountFallback.current;
    // 开发模式的严格模式会把 effect 跑两遍，补取只该有一次
    if (mountChecked.current) return;
    mountChecked.current = true;
    if (!initial.ok) return;
    const now = Date.now();
    if (lag) {
      if (!cadenceMs || revalidateOnMount === false || !lagOverdue(initial.updatedAt, cadenceMs, now)) return;
    } else {
      // 没关挂载回源的实时视图由 SWR 自己在挂载时回源
      const cardMs = refreshIntervalRef.current;
      if (revalidateOnMount !== false || typeof cardMs !== "number" || cardMs <= 0) return;
      if (!fallbackOutlived(initial.servedAt, cardMs, now)) return;
    }
    // 同一个键的另一个消费者刚补取过：结果走共享缓存，这边不再发一条并发的
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

/**
 * payload 自己说了「多久之后就不成立」时，把一次重取排在那一刻。
 *
 * 有些结论会光靠时间流逝失效 —— 比如播放来源的暂停宽限期（见
 * pickNowListening 的 expiresInMs）。那个到期时刻不对应任何一次上报，
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
      // 多等一小会儿：到期时刻在服务端是绝对的，早问一下只会拿回同一份还没过期的
      Math.max(250, expiresInMs + 250),
    );
    return () => clearTimeout(timer);
  }, [path, expiresInMs, mutate]);
}
