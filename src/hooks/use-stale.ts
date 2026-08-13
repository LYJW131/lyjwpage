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

/** Mac 上报器那一层：心跳 45 秒，或亲口离线。 */
export function useReporterStale(presence: ReporterPresence | undefined) {
  return useStale(
    presence?.lastSeenAt,
    HEARTBEAT_WINDOW_MS,
    Boolean(presence?.declaredOffline),
  );
}
