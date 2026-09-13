import { mirrorKey } from "@/lib/storage";
import type {
  PlaystationPlayingPayload,
  PlaystationPowerPayload,
  PlaystationPresencePayload,
  TrophiesPayload,
} from "@/lib/types";

/**
 * 30 天：playedGames 只在内容变化时上报，没有固定的整份兜底，隔一阵不玩也不该
 * 把最近在玩弄丢。presence 每轮 cron 都刷新（心跳），够不到这个 TTL —— 它靠
 * observedAt 判断断流，见 lib/playstation 的 assertPresenceFresh，快照留多久
 * 都不会让页面举着过期的「正在游玩」。
 * SQLite 为主、进程内存为辅的行为由 mirrorKey 统一负责。
 */
export const TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const presenceMirror = mirrorKey<PlaystationPresencePayload>(
  ["playstation", "presence"],
  (state) => state.observedAt,
  { ttlMs: TTL_MS },
);

/**
 * 电源状态只在 HA 那个开关翻面时上报，翻一次可能隔好几天，所以**不设 TTL** ——
 * 过期会让判定退回「不知道」，而不知道的默认是按开机处理，等于白白多跑一整天的
 * 快档。presence 那 30 天 TTL 在这里不适用：它每轮都刷新，这一份不会。
 */
export const powerMirror = mirrorKey<PlaystationPowerPayload>(
  ["playstation", "power"],
  (state) => state.observedAt,
);

export const playedGamesMirror = mirrorKey<PlaystationPlayingPayload>(
  ["playstation", "playedGames"],
  (state) => state.observedAt,
  { ttlMs: TTL_MS },
);

/**
 * 奖杯目录可能几周才变一次。presence / playedGames 那 30 天 TTL 在这里会把首页
 * 瓷砖展开里的整份奖杯明细弄丢，所以这份不设过期，只等下一封上报覆盖。
 */
export const trophiesMirror = mirrorKey<TrophiesPayload>(
  ["playstation", "trophies"],
  (state) => state.observedAt,
);
