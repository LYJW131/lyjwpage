"use client";

import { useEffect, useMemo, useState } from "react";

import { useMountedAt } from "@/hooks/use-mounted-at";
import { usePageActive } from "@/hooks/use-status";
import {
  HEARTBEAT_WINDOW_MS,
  chargingFeedClockStale,
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
 * 访客钟：首帧（服务端预渲染和 hydrate）是 0，挂载后是挂载那一刻，之后每到一个
 * deadline 往前推一次。
 *
 * 已经过期的快照靠 useMountedAt 在挂载后立刻判；timer 只预约还没到的那一刻。
 * 两个 deadline 是充电头那种「两扇窗口取或」的用法：先到的那个翻完，effect 带着
 * 新的 ticked 再跑一遍，把后到的那个排上。
 */
function useClock(first: number | null, second: number | null = null): number {
  const mountedAt = useMountedAt();
  const [ticked, setTicked] = useState(0);

  useEffect(() => {
    const now = Date.now();
    const upcoming = [first, second].filter((at): at is number => at != null && at > now);
    if (!upcoming.length) return;
    const timer = window.setTimeout(() => setTicked(Date.now()), Math.min(...upcoming) - now + 250);
    return () => window.clearTimeout(timer);
  }, [first, second, ticked]);

  return ticked || mountedAt;
}

/**
 * 按源站盖章的时刻在浏览器现算 stale。
 *
 * 到点自己翻，不必为了「心跳窗口过了」再打一次接口。
 */
export function useStale(
  at: number | null | undefined,
  windowMs: number,
  declaredOffline = false,
) {
  const now = useClock(declaredOffline ? null : deadlineOf(at, windowMs));
  return isStale({ now, at, windowMs, declaredOffline });
}

/**
 * 按访客钟判出来的过期，什么时候才当真。
 *
 * 手上这份可能是旧的：首屏 HTML 冻了好几分钟、标签页在后台停了轮询。这两种时候
 * 钟说「过期了」只说明没人去问，而 SWR 此刻正好在回源（实时卡的挂载校验在首帧就
 * 标着 isValidating，切回前台也会回源）—— 回源途中先不认，等回来的那份再判。
 *
 * 回源回来还是过期，或者页面开着时到点翻过期，就当真并且按住：之后每一轮轮询的
 * isValidating 不再把它翻回去（否则 Mac 悄悄死掉之后，每轮轮询都会闪回一下
 * 最后那个前台应用），直到数据重新新鲜、或页面退到后台。后台时一律不认 —— 没人
 * 看，切回前台那一刻手上的读数也没意义，交给回源。
 *
 * 只管按钟判的那部分。亲口离线不是时间函数，调用方直接认，别塞进来。
 */
export function useConfirmedStale(stale: boolean, validating: boolean): boolean {
  const active = usePageActive();
  const [held, setHeld] = useState(false);
  // 渲染期就地对齐，不放进 effect：多渲染一轮之外，set-state-in-effect 也不许
  if (stale && active && !validating && !held) setHeld(true);
  else if ((!stale || !active) && held) setHeld(false);
  return stale && active && (held || !validating);
}

/**
 * Mac 上报器那一层：窗口跟 payload 里的 heartbeatWindowMs，或亲口离线。
 *
 * 两个判据分开给出来，因为它们能用的时机不一样：
 *
 * - `declared` 是上报器亲口说的离线，一个数据字段，首帧就作数，也不受回源影响。
 * - `byClock` 是浏览器拿自己的钟现算的心跳窗口，首帧（没有钟）恒为 false。要不要
 *   挡掉回源途中那一段，由卡片决定（见 useConfirmedStale）。
 *
 * 日常用 `offline`（两者取或）就行。
 */
export function useReporterStale(presence: ReporterPresence | undefined) {
  const byClock = useStale(presence?.lastSeenAt, presence?.heartbeatWindowMs ?? HEARTBEAT_WINDOW_MS);
  const declared = Boolean(presence?.declaredOffline);
  return { offline: declared || byClock, declared, byClock };
}

/**
 * 充电头 / 充电宝：把「这一路此刻还算不算连着」盖回 `connected`，返回盖好的那份。
 *
 * 判据见 lib/freshness 的 liveChargingFeed。卡片拿返回值照旧读 `connected`，
 * 状态灯、端口、布局（media-pair）都跟着同一个答案走。`validating` 传这份数据
 * 所在 SWR 键的 isValidating，挡掉挂载校验、切回前台回源途中那一段。
 */
export function useLiveChargingFeed<T extends ChargingFeed>(
  feed: T | undefined,
  validating: boolean,
): T | undefined {
  const now = useClock(
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
  validating: boolean,
): NowListeningPayload | undefined {
  const { declared, byClock } = useReporterStale(payload);
  const clockOffline = useConfirmedStale(byClock, validating);
  const macOffline = declared || clockOffline;
  return useMemo(() => (payload ? liveNowListening(payload, macOffline) : undefined), [payload, macOffline]);
}
