"use client";

import { useEffect, useMemo, useState } from "react";

import { useMountedAt } from "@/hooks/use-mounted-at";
import { usePageActive } from "@/hooks/use-status";
import {
  HEARTBEAT_WINDOW_MS,
  RESUME_REFETCH_GRACE_MS,
  chargingFeedClockStale,
  clockAdvance,
  clockReading,
  confirmStale,
  hasPendingDeadline,
  isStale,
  liveChargingFeed,
  liveNowListening,
  resumeStep,
  resumeTimedOut,
  type ChargingFeed,
  type ResumeState,
} from "@/lib/freshness";
import type { NowListeningPayload, ReporterPresence } from "@/lib/types";

/**
 * `at` 开始算过期的第一刻：isStale 判的是「超过」窗口（严格大于），所以是窗口之后那一毫秒。
 * 取窗口本身的话，钟正好推到那一刻时判不出过期、deadline 又不再晚于钟，钟就停住了。
 * 从没见过（0 / 缺省）没有到点可等。
 */
function deadlineOf(at: number | null | undefined, windowMs: number): number | null {
  return at != null && at > 0 ? at + windowMs + 1 : null;
}

/** 访客钟此刻的读数，以及它对手上这份数据作不作准 */
type Clock = {
  now: number;
  /**
   * 没有晚于钟的 deadline，或者晚于钟的那些都核对过还没到。为假时钟可能正落后于
   * 一个其实已经过了的 deadline —— 这时判出的「不过期」不可靠，见 confirmStale。
   */
  settled: boolean;
};

/**
 * 访客钟。
 *
 * 首帧（服务端预渲染和 hydrate）是首屏那份信封的 `servedAt` —— 源站交出这份数据的
 * 时刻，两边读到的是同一个值，不会水合不一致；首屏 HTML 冻多久，这把钟就停在当时，
 * 判出来的正是填缓存那一刻源站会下的结论。没有 servedAt（信封降级、旧版本源站）
 * 就是 0，什么都不判。挂载后换成挂载那一刻，之后每到一个 deadline 往前推一次；
 * 读数只进不退（见 lib/freshness 的 clockReading）。
 *
 * 怎么推见 lib/freshness 的 clockAdvance：真实时间里已经过了的 deadline 下一个任务
 * 就推（推上去之前 settled 为假），还没到的排定时器。渲染期不读 Date.now()，核对
 * 只在 effect 里做、状态只在定时器回调里改。两个 deadline 是充电头那种「两扇窗口
 * 取或」的用法。
 */
function useClock(servedAt: number | undefined, first: number | null, second: number | null = null): Clock {
  const mountedAt = useMountedAt();
  const [ticked, setTicked] = useState(0);
  const now = clockReading(ticked, mountedAt, servedAt);
  const key = `${now}|${first}|${second}`;
  // 核对过「晚于钟的 deadline 都还没到」的那一组（钟读数 + deadline）
  const [checked, setChecked] = useState<string | null>(null);
  const settled = !hasPendingDeadline(now, [first, second]) || checked === key;

  useEffect(() => {
    const advance = clockAdvance(now, [first, second], Date.now());
    if (advance.kind === "idle") return;
    // 推到此刻与 deadline 里较晚的那个：系统时钟往回调过也保证跨过它（见 clockAdvance）
    const tick = () => setTicked(Math.max(Date.now(), advance.to));
    if (advance.kind === "now") {
      const timer = window.setTimeout(tick, 0);
      return () => window.clearTimeout(timer);
    }
    // 都还没到：这把钟对这份数据是准的，放行；到点再推
    const settle = window.setTimeout(() => setChecked(key), 0);
    const timer = window.setTimeout(tick, advance.delayMs);
    return () => {
      window.clearTimeout(settle);
      window.clearTimeout(timer);
    };
  }, [first, second, now, key]);

  return { now, settled };
}

/** 按钟判 `at` 过没过 `windowMs`，连同钟作不作准一起给 */
function useClockStale(at: number | null | undefined, windowMs: number, servedAt?: number) {
  const { now, settled } = useClock(servedAt, deadlineOf(at, windowMs));
  return { stale: isStale({ now, at, windowMs }), settled };
}

/**
 * 按源站盖章的时刻在浏览器现算 stale。
 *
 * 到点自己翻，不必为了「心跳窗口过了」再打一次接口。`servedAt` 传这份数据所在
 * useStatus 的 servedAt（首屏信封的出站时刻），首帧拿它当钟。
 */
export function useStale(at: number | null | undefined, windowMs: number, servedAt?: number) {
  return useClockStale(at, windowMs, servedAt).stale;
}

/**
 * 按访客钟判出来的过期，什么时候才当真。规则见 lib/freshness 的 confirmStale：
 * 回源途中和后台不做新的确认，确认下来之后按住，只有数据重新新鲜（且钟对新数据
 * 作准）才松开。「回源途中」包括刚切回前台、SWR 那次回源还没开始的那一拍
 * （lib/freshness 的 resumeStep）。
 *
 * 首帧判出来的过期直接算确认过：那一帧的钟是首屏信封的 servedAt，判的就是源站
 * 交出这份数据时的结论（从前 offlineAtSource 那个字段的意思），不用等回源。
 * 首屏 HTML 冻着、而 Mac 已经回来了的话，挂载校验带回新数据，过期不成立就松开。
 *
 * 只管按钟判的那部分。亲口离线不是时间函数，调用方直接认，别塞进来。
 */
export function useConfirmedStale(stale: boolean, validating: boolean, settled = true): boolean {
  const active = usePageActive();
  const [resume, setResume] = useState<ResumeState>({ active, resuming: false, sawValidating: false });
  const nextResume = resumeStep(resume, { active, validating });
  // 渲染期就地对齐，不放进 effect：多渲染一轮之外，set-state-in-effect 也不许
  if (nextResume !== resume) setResume(nextResume);
  const waitingForRefetch = nextResume.resuming && !nextResume.sawValidating;
  useEffect(() => {
    if (!waitingForRefetch) return;
    const timer = window.setTimeout(() => setResume(resumeTimedOut), RESUME_REFETCH_GRACE_MS);
    return () => window.clearTimeout(timer);
  }, [waitingForRefetch]);

  const [held, setHeld] = useState(stale);
  const next = confirmStale(held, {
    stale,
    active,
    validating: validating || nextResume.resuming,
    settled,
  });
  if (next.held !== held) setHeld(next.held);
  return next.stale;
}

/** 判活要的两样，都来自这份数据所在的 useStatus */
export type StatusTiming = {
  /** 那个 SWR 键的 isValidating：挡掉挂载校验、切回前台回源途中那一段 */
  validating: boolean;
  /** 首屏信封的出站时刻，首帧的钟 */
  servedAt?: number;
};

/** `at` 过了 `windowMs` 算过期：按钟判，再过 useConfirmedStale 那道确认 */
export function useConfirmedClockStale(
  at: number | null | undefined,
  windowMs: number,
  { validating, servedAt }: StatusTiming,
): boolean {
  const { stale, settled } = useClockStale(at, windowMs, servedAt);
  return useConfirmedStale(stale, validating, settled);
}

/**
 * Mac 上报器那一层：窗口跟 payload 里的 heartbeatWindowMs，或亲口离线。
 *
 * 两个判据分开给出来，因为它们能用的时机不一样：
 *
 * - `declared` 是上报器亲口说的离线，一个数据字段，首帧就作数，也不受回源影响。
 * - `byClock` 是拿访客钟现算的心跳窗口（首帧用 servedAt）。要不要挡掉回源途中
 *   那一段，由卡片决定（见 useConfirmedStale，`settled` 一起传过去）。
 *
 * 日常用 `offline`（两者取或）就行。
 */
export function useReporterStale(presence: ReporterPresence | undefined, servedAt?: number) {
  const { stale: byClock, settled } = useClockStale(
    presence?.lastSeenAt,
    presence?.heartbeatWindowMs ?? HEARTBEAT_WINDOW_MS,
    servedAt,
  );
  const declared = Boolean(presence?.declaredOffline);
  return { offline: declared || byClock, declared, byClock, settled };
}

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
  const { now, settled } = useClock(
    servedAt,
    feed ? deadlineOf(feed.lastSeenAt, feed.heartbeatWindowMs) : null,
    feed ? deadlineOf(feed.pushedAt, feed.staleAfterMs) : null,
  );
  const clockStale = useConfirmedStale(
    feed ? chargingFeedClockStale(feed, now) : false,
    validating,
    settled,
  );
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
  const { declared, byClock, settled } = useReporterStale(payload, servedAt);
  const clockOffline = useConfirmedStale(byClock, validating, settled);
  const macOffline = declared || clockOffline;
  return useMemo(() => (payload ? liveNowListening(payload, macOffline) : undefined), [payload, macOffline]);
}
