import { mirrorKey } from "@/lib/storage";
import type {
  PlaystationPlayingPayload,
  PlaystationPowerPayload,
  PlaystationPresencePayload,
  TrophiesPayload,
} from "@/lib/types";

/**
 * 保留很久：playedGames 只在内容变化时上报，没有固定的整份兜底，隔一阵不玩也不该
 * 把最近在玩弄丢。presence 每个完整 tick 都刷新（心跳），间隔远小于这个 TTL —— 浏览器
 * 靠 observedAt 判断断流（见 lib/playstation 的 getPlayingNow），快照留多久
 * 都不会让页面举着过期的「正在游玩」。读写规则见 lib/storage 的 mirrorKey。
 */
export const TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const presenceMirror = mirrorKey<PlaystationPresencePayload>(
  ["playstation", "presence"],
  (state) => state.observedAt,
  { ttlMs: TTL_MS },
);

/** 内部 `StateCore.playstationPower()` RPC 保留的只读镜像，不删除已存数据。 */
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
 * 奖杯目录可能几周才变一次。presence / playedGames 那份 TTL 在这里会把首页
 * 瓷砖展开里的整份奖杯明细弄丢，所以这份不设过期，只等下一封上报覆盖。
 */
export const trophiesMirror = mirrorKey<TrophiesPayload>(
  ["playstation", "trophies"],
  (state) => state.observedAt,
);
