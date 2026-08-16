"use client";

import { useEffect, useState } from "react";

import { useMountedAt } from "@/hooks/use-mounted-at";
import { HEARTBEAT_WINDOW_MS, isStale } from "@/lib/freshness";
import type { ReporterPresence } from "@/lib/types";

/**
 * 按源站盖章的时刻在浏览器现算 stale。
 *
 * 到点自己翻，不必为了「心跳窗口过了」再打一次接口。已经过期的快照靠
 * useMountedAt 在挂载后立刻判；这里的 timer 只预约还没到的那一刻。
 */
export function useStale(
  at: number | null | undefined,
  windowMs: number,
  declaredOffline = false,
) {
  const mountedAt = useMountedAt();
  const [now, setNow] = useState(0);
  const t = now || mountedAt;
  const stale = isStale({ now: t, at, windowMs, declaredOffline });

  useEffect(() => {
    if (declaredOffline) return;
    if (at == null || at <= 0) return;
    const remain = windowMs - (Date.now() - at);
    if (remain <= 0) return;
    const timer = window.setTimeout(() => setNow(Date.now()), remain + 250);
    return () => window.clearTimeout(timer);
  }, [at, windowMs, declaredOffline]);

  return stale;
}

/**
 * Mac 上报器那一层：窗口跟 payload 里的 heartbeatWindowMs，或亲口离线。
 *
 * 两个判据分开给出来，因为它们能用的时机不一样：
 *
 * - `atSource` 是源站在取数出口算好的（见 ReporterPresence 的 offlineAtSource），
 *   是**首帧唯一能用的那个** —— 那一帧 useMountedAt 还是 0，byClock 恒为 false。
 *   它也不会随本地钟老化，所以标签页睡了两小时醒来时它仍然作数。
 * - `byClock` 是浏览器拿自己的钟现算的，管的是「拿到这份之后又过了多久」。
 *
 * 日常用 `offline`（两者取或）就行；只有需要区别对待「本地钟老化」的地方
 * （见 live-desk-card 的回源守卫）才拆开用。
 */
export function useReporterStale(presence: ReporterPresence | undefined) {
  const byClock = useStale(
    presence?.lastSeenAt,
    presence?.heartbeatWindowMs ?? HEARTBEAT_WINDOW_MS,
    Boolean(presence?.declaredOffline),
  );
  const atSource = Boolean(presence?.offlineAtSource);
  return { offline: atSource || byClock, atSource, byClock };
}
