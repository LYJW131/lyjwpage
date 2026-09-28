"use client";

import { useEffect, useMemo, useState } from "react";

import { useMountedAt } from "@/hooks/use-mounted-at";
import { usePageActive } from "@/hooks/use-status";
import {
  HEARTBEAT_WINDOW_MS,
  chargingFeedClockStale,
  clockAdvanceDelay,
  confirmStale,
  isStale,
  liveChargingFeed,
  liveNowListening,
  type ChargingFeed,
} from "@/lib/freshness";
import type { NowListeningPayload, ReporterPresence } from "@/lib/types";

/** `at` 过了 `windowMs` 的那一刻；从没见过（0 / 缺省）没有到点可等 */
function deadlineOf(at: number | null | undefined, windowMs: number): number | null {
  return at != null && at > 0 ? at + windowMs : null;
}

/**
 * 访客钟。
 *
 * 首帧（服务端预渲染和 hydrate）是首屏那份信封的 `servedAt` —— 源站交出这份数据的
 * 时刻，两边读到的是同一个值，不会水合不一致；首屏 HTML 冻多久，这把钟就停在当时，
 * 判出来的正是填缓存那一刻源站会下的结论。没有 servedAt（信封降级、旧版本源站）
 * 就是 0，什么都不判。挂载后换成挂载那一刻，之后每到一个 deadline 往前推一次。
 *
 * 该推的时机见 lib/freshness 的 clockAdvanceDelay：晚于钟的 deadline 一律排上，
 * 真实时间里已经过了的立刻推。两个 deadline 是充电头那种「两扇窗口取或」的用法。
 */
function useClock(servedAt: number | undefined, first: number | null, second: number | null = null): number {
  const mountedAt = useMountedAt();
  const [ticked, setTicked] = useState(0);
  const now = ticked || mountedAt || servedAt || 0;

  useEffect(() => {
    const delay = clockAdvanceDelay(now, [first, second], Date.now());
    if (delay == null) return;
    const timer = window.setTimeout(() => setTicked(Date.now()), delay);
    return () => window.clearTimeout(timer);
  }, [first, second, now]);

  return now;
}

/**
 * 按源站盖章的时刻在浏览器现算 stale。
 *
 * 到点自己翻，不必为了「心跳窗口过了」再打一次接口。`servedAt` 传这份数据所在
 * useStatus 的 servedAt（首屏信封的出站时刻），首帧拿它当钟。
 */
export function useStale(at: number | null | undefined, windowMs: number, servedAt?: number) {
  const now = useClock(servedAt, deadlineOf(at, windowMs));
  return isStale({ now, at, windowMs });
}

/**
 * 按访客钟判出来的过期，什么时候才当真。规则见 lib/freshness 的 confirmStale：
 * 回源途中和后台不做新的确认，确认下来之后按住，只有数据重新新鲜才松开。
 *
 * 首帧判出来的过期直接算确认过：那一帧的钟是首屏信封的 servedAt，判的就是源站
 * 交出这份数据时的结论（从前 offlineAtSource 那个字段的意思），不用等回源。
 * 首屏 HTML 冻着、而 Mac 已经回来了的话，挂载校验带回新数据，过期不成立就松开。
 *
 * 只管按钟判的那部分。亲口离线不是时间函数，调用方直接认，别塞进来。
 */
export function useConfirmedStale(stale: boolean, validating: boolean): boolean {
  const active = usePageActive();
  const [held, setHeld] = useState(stale);
  const next = confirmStale(held, { stale, active, validating });
  // 渲染期就地对齐，不放进 effect：多渲染一轮之外，set-state-in-effect 也不许
  if (next.held !== held) setHeld(next.held);
  return next.stale;
}

/**
 * Mac 上报器那一层：窗口跟 payload 里的 heartbeatWindowMs，或亲口离线。
 *
 * 两个判据分开给出来，因为它们能用的时机不一样：
 *
 * - `declared` 是上报器亲口说的离线，一个数据字段，首帧就作数，也不受回源影响。
 * - `byClock` 是拿访客钟现算的心跳窗口（首帧用 servedAt）。要不要挡掉回源途中
 *   那一段，由卡片决定（见 useConfirmedStale）。
 *
 * 日常用 `offline`（两者取或）就行。
 */
export function useReporterStale(presence: ReporterPresence | undefined, servedAt?: number) {
  const byClock = useStale(
    presence?.lastSeenAt,
    presence?.heartbeatWindowMs ?? HEARTBEAT_WINDOW_MS,
    servedAt,
  );
  const declared = Boolean(presence?.declaredOffline);
  return { offline: declared || byClock, declared, byClock };
}

/** 判活要的两样，都来自这份数据所在的 useStatus */
export type StatusTiming = {
  /** 那个 SWR 键的 isValidating：挡掉挂载校验、切回前台回源途中那一段 */
  validating: boolean;
  /** 首屏信封的出站时刻，首帧的钟 */
  servedAt?: number;
};

/**
 * 充电头 / 充电宝：把「这一路此刻还算不算连着」盖回 `connected`，返回盖好的那份。
 *
 * 判据见 lib/freshness 的 liveChargingFeed。卡片拿返回值照旧读 `connected`，
 * 状态灯、端口、布局（media-pair）都跟着同一个答案走。
 */
export function useLiveChargingFeed<T extends ChargingFeed>(
  feed: T | undefined,
  { validating, servedAt }: StatusTiming,
): T | undefined {
  const now = useClock(
    servedAt,
    feed ? deadlineOf(feed.lastSeenAt, feed.heartbeatWindowMs) : null,
    feed ? deadlineOf(feed.pushedAt, feed.staleAfterMs) : null,
  );
  const clockStale = useConfirmedStale(feed ? chargingFeedClockStale(feed, now) : false, validating);
  return useMemo(() => (feed ? liveChargingFeed(feed, clockStale) : undefined), [feed, clockStale]);
}

/**
 * 「正在听」：选中的是 Mac 那首而 Mac 已经掉线时，换成 payload 里的 alternate，
 * 返回换好的那份（判据见 lib/freshness 的 liveNowListening）。
 *
 * 按钟判的掉线同样要过 useConfirmedStale：首屏冻住的那份在挂载校验回来之前不认，
 * 否则 HTML 放了五分钟以上时，每次打开页面都会先把 Mac 那首撤掉、回源回来再放回去。
 */
export function useLiveNowListening(
  payload: NowListeningPayload | undefined,
  { validating, servedAt }: StatusTiming,
): NowListeningPayload | undefined {
  const { declared, byClock } = useReporterStale(payload, servedAt);
  const clockOffline = useConfirmedStale(byClock, validating);
  const macOffline = declared || clockOffline;
  return useMemo(() => (payload ? liveNowListening(payload, macOffline) : undefined), [payload, macOffline]);
}
