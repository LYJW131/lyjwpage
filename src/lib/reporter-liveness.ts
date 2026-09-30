import { heartbeatWindowMs } from "@/lib/freshness";
import type { ReporterPresence } from "@/lib/types";
import { type Liveness, mirror } from "@shared/reporter-liveness";

function neverSeen(): Liveness {
  return { lastSeenAt: 0, declaredOffline: false };
}

export async function readLiveness(): Promise<Liveness> {
  return (await mirror.get()) ?? neverSeen();
}

// 读改写依赖唯一写入口及同一设备信封串行发送；增加写者前必须重新保证原子性。
export function nextLiveness(
  previous: Liveness,
  { offline, at }: { offline: boolean; at: number },
): { next: Liveness; flipped: boolean } {
  return {
    next: { lastSeenAt: at, declaredOffline: offline },
    flipped: previous.declaredOffline !== offline,
  };
}

export function offlineByLiveness(liveness: Liveness, now = Date.now()) {
  if (liveness.declaredOffline) return true;
  return !liveness.lastSeenAt || now - liveness.lastSeenAt > heartbeatWindowMs();
}

// 存活结论随时间变化，缓存只携带原始事实，不能冻结在线结论。
export function withPresence<T extends object>(data: T, live: Liveness): T & ReporterPresence {
  return {
    ...data,
    lastSeenAt: live.lastSeenAt,
    declaredOffline: live.declaredOffline,
    heartbeatWindowMs: heartbeatWindowMs(),
  };
}
export { type Liveness } from "@shared/reporter-liveness";
