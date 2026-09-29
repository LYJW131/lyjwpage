import { heartbeatWindowMs } from "@/lib/freshness";
import type { ReporterPresence } from "@/lib/types";
import { type Liveness, mirror } from "@shared/reporter-liveness";

/** 从没见过上报器。也是 Storage 被清空后的样子 */
function neverSeen(): Liveness {
  return { lastSeenAt: 0, declaredOffline: false };
}

export async function readLiveness(): Promise<Liveness> {
  return (await mirror.get()) ?? neverSeen();
}

/**
 * 记一次露面：这条信封之后的存活，以及离线声明有没有翻转。
 *
 * 纯计算，读在调用方、写在 writeLiveness。拆成三段是为了让写能和推送同时进行 ——
 * 推给浏览器的那几份状态都带着存活，而存活的新值这里就算得出来，用不着等它落库
 * 再从存储读回来。读-改-写因此不是原子的，但写它的只有唯一的上报入口，
 * 且同一台 Mac 的信封本来就是串行发的，不存在两个写者互相盖。
 */
export function nextLiveness(
  previous: Liveness,
  { offline, at }: { offline: boolean; at: number },
): { next: Liveness; flipped: boolean } {
  return {
    next: { lastSeenAt: at, declaredOffline: offline },
    flipped: previous.declaredOffline !== offline,
  };
}

/**
 * 拿在手上的那份存活算不算离线。只剩「正在听」选来源（pickNowListening，
 * 取数、推送、pulse 共用）还要在源站判它；卡片上的在线状态一律由浏览器判。
 *
 * `now` 收调用方那把钟：同一次判定里往往还有别的按时间算的东西（暂停宽限、
 * HomePod 静默），它们都拿着同一个 `now`，这里再自己读一次
 * Date.now() 的话，同一个判定里就有了两把钟 —— 生产上差几微秒无所谓，
 * 但那些函数的 `now` 形参也就只是半真的，想给它们写单测立刻踩到。
 */
export function offlineByLiveness(liveness: Liveness, now = Date.now()) {
  // 亲口说走了就直接算离线，不用等心跳窗口
  if (liveness.declaredOffline) return true;
  return !liveness.lastSeenAt || now - liveness.lastSeenAt > heartbeatWindowMs();
}

/**
 * 把源站刚读到的存活盖进快照。
 *
 * 只盖三个原始事实，不盖「此刻在不在线」的结论：那是时间的函数，盖进去就会跟着
 * 首屏缓存冻住。浏览器拿这三项和自己的钟判，见 ReporterPresence 的注释。
 */
export function withPresence<T extends object>(data: T, live: Liveness): T & ReporterPresence {
  return {
    ...data,
    lastSeenAt: live.lastSeenAt,
    declaredOffline: live.declaredOffline,
    heartbeatWindowMs: heartbeatWindowMs(),
  };
}
export { type Liveness } from "@shared/reporter-liveness";
