import { mirrorKey } from "@/lib/redis";
import type {
  PlaystationPlayingPayload,
  PlaystationPresencePayload,
  TrophiesPayload,
} from "@/lib/types";

/**
 * 30 天：playedGames 只在内容变化时上报，没有固定的整份兜底，隔一阵不玩也不该
 * 把最近在玩弄丢。presence 每轮 cron 都刷新（心跳），够不到这个 TTL —— 它靠
 * observedAt 判断断流，见 lib/playstation 的 assertPresenceFresh，快照留多久
 * 都不会让页面举着过期的「正在游玩」。
 * Redis 为主、进程内存为辅的行为由 mirrorKey 统一负责。
 */
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

const presenceMirror = mirrorKey<PlaystationPresencePayload>(
  ["playstation", "presence"],
  (state) => state.observedAt,
  { ttlMs: TTL_MS },
);

const playedGamesMirror = mirrorKey<PlaystationPlayingPayload>(
  ["playstation", "playedGames"],
  (state) => state.observedAt,
  { ttlMs: TTL_MS },
);

export function getPlaystationPresence() {
  return presenceMirror.get();
}

export function setPlaystationPresence(payload: PlaystationPresencePayload) {
  return presenceMirror.put(payload);
}

export function getPlaystationPlayedGames() {
  return playedGamesMirror.get();
}

export function setPlaystationPlayedGames(payload: PlaystationPlayingPayload) {
  return playedGamesMirror.put(payload);
}

/**
 * 奖杯目录可能几周才变一次。presence / playedGames 那 30 天 TTL 在这里会把首页
 * 瓷砖展开里的整份奖杯明细弄丢，所以这份不设过期，只等下一封上报覆盖。
 */
const trophiesMirror = mirrorKey<TrophiesPayload>(
  ["playstation", "trophies"],
  (state) => state.observedAt,
);

export function getPlaystationTrophies() {
  return trophiesMirror.get();
}

export function setPlaystationTrophies(payload: TrophiesPayload) {
  return trophiesMirror.put(payload);
}
