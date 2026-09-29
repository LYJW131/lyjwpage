import { mirrorKey } from "@/lib/storage";
import type { ReporterPresence } from "@/lib/types";

/**
 * 上报器还活不活着 —— 全站唯一的判据。
 *
 * 单独成一个模块，是为了让 anker / coding-usage / telemetry 都能读它而不产生
 * 循环依赖（telemetry 本来就要引 anker，反过来再引就成环了）。
 *
 * 存活是一个事实，不该有几个答案：各卡各判、阈值不一，同一台 Mac 掉线时它们会先后
 * 错开变灰。
 *
 * 注意这里只回答「上报器在不在」。各模块「自己的数据够不够新」是另一回事，
 * 仍然由各自判断，两者取或 —— 比如充电头那一路断了流，即使 Mac 在线，那一格也该
 * 显示为断开（lib/freshness 的 liveChargingFeed）。
 */

export type Liveness = Pick<ReporterPresence, "lastSeenAt" | "declaredOffline">;

/**
 * 存活单独占一个 SQLite key，读写都直查 SQLite：存活是全站共享的一个事实，得存在
 * 共享的地方，不能各进程各持一份 —— 否则没接过上报的那个进程手上永远是零，
 * 会把所有卡判成离线。读写规则见 lib/storage 的 mirrorKey。
 */
export const mirror = mirrorKey<Liveness>(
  ["reporter", "liveness"],
  // 「有多新」看最后一次露面：每条信封都会推进它
  (state) => state.lastSeenAt,
);
