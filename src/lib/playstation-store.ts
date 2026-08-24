import { mirrorKey } from "@/lib/redis";
import type {
  PlaystationPlayingPayload,
  PlaystationPresencePayload,
} from "@/lib/types";

/**
 * Worker 只在内容变化时上报，没有固定的整份兜底，所以两份快照都留 30 天。
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
