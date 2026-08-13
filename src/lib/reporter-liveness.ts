import { HEARTBEAT_WINDOW_MS } from "@/lib/freshness";
import { mirrorKey } from "@/lib/redis";
import type { ReporterPresence } from "@/lib/types";

/**
 * 上报器还活不活着 —— 全站唯一的判据。
 *
 * 单独成一个模块，是为了让 anker / vibecoding / telemetry 都能读它而不产生
 * 循环依赖（telemetry 本来就要引 anker，反过来再引就成环了）。
 *
 * 从前这件事在三个地方各判一次，阈值还都不一样：desktop/music 45 秒、
 * charger 90 秒、vibe_coding 15 分钟。同一台 Mac 掉线时三张卡会先后错开变灰，
 * 最长差十几分钟。存活是一个事实，不该有三个答案。
 *
 * 注意这里只回答「上报器在不在」。各模块「自己的数据够不够新」是另一回事，
 * 仍然由各自判断，两者取或 —— 比如 CodexBar 十几分钟没刷新，即使 Mac 在线，
 * 那张卡也该显示为陈旧。
 */

export type Liveness = ReporterPresence;

/**
 * 存活单独占一个 Redis key，读写都直查 Redis。
 *
 * 从前它是纯进程内存，靠遥测状态那份镜像搭车持久化 —— 于是两个进程各有一份
 * 各自的「上次见到」：多实例部署时，没接过上报的那个实例手上永远是零，四张卡
 * 全被判成离线，而另一个实例好好的。存活是全站共享的一个事实，得存在共享的
 * 地方。
 *
 * 「Redis 为主、进程内存为辅」的规则见 lib/redis 的 mirrorKey：Redis 答得上话
 * 就以它为准，不可达才退回内存副本 —— 单机部署因此和从前一样能跑，Redis 没配
 * 或挂掉都只是退化成进程内的判断，不会把页面打成离线。
 */
const mirror = mirrorKey<Liveness>(
  ["reporter", "liveness"],
  // 「有多新」看最后一次露面：每条信封都会推进它
  (state) => state.lastSeenAt,
);

/** 从没见过上报器。也是 Redis 被清空后的样子 */
function neverSeen(): Liveness {
  return { lastSeenAt: 0, declaredOffline: false };
}

export async function readLiveness(): Promise<Liveness> {
  return (await mirror.get()) ?? neverSeen();
}

/**
 * 记一次露面：刷新存活时刻，并落下这条信封声明的在离线。
 *
 * 返回离线声明有没有翻转，调用方据此决定要不要推送。读-改-写不是原子的，
 * 但写它的只有唯一的上报入口，且同一台 Mac 的信封本来就是串行发的，不存在
 * 两个写者互相盖。
 */
export async function recordReporterBeat({
  offline,
  at = Date.now(),
}: {
  offline: boolean;
  at?: number;
}): Promise<{ flipped: boolean }> {
  const previous = await readLiveness();
  await mirror.put({ lastSeenAt: at, declaredOffline: offline });
  return { flipped: previous.declaredOffline !== offline };
}

/** 拿在手上的那份存活算不算离线。取数路径上已经读过就用这个，别再问一次 Redis */
export function offlineByLiveness(liveness: Liveness) {
  // 亲口说走了就直接算离线，不用等心跳窗口
  if (liveness.declaredOffline) return true;
  return !liveness.lastSeenAt || Date.now() - liveness.lastSeenAt > HEARTBEAT_WINDOW_MS;
}

/** 把源站刚读到的存活盖进快照。stale 仍然不在这里算。 */
export function withPresence<T extends object>(data: T, live: Liveness): T & ReporterPresence {
  return {
    ...data,
    lastSeenAt: live.lastSeenAt,
    declaredOffline: live.declaredOffline,
  };
}
