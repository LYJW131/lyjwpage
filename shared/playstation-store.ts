import { mirrorKey } from "@/lib/storage";
import type {
  PlaystationPlayingPayload,
  PlaystationPowerPayload,
  PlaystationPresencePayload,
  TrophiesPayload,
} from "@/lib/types";

export const TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const presenceMirror = mirrorKey<PlaystationPresencePayload>(
  ["playstation", "presence"],
  (state) => state.observedAt,
  { ttlMs: TTL_MS },
);

export const powerMirror = mirrorKey<PlaystationPowerPayload>(
  ["playstation", "power"],
  (state) => state.observedAt,
);

export const playedGamesMirror = mirrorKey<PlaystationPlayingPayload>(
  ["playstation", "playedGames"],
  (state) => state.observedAt,
  { ttlMs: TTL_MS },
);

// 奖杯目录可能数周不变，不能随 presence 的 TTL 过期。
export const trophiesMirror = mirrorKey<TrophiesPayload>(
  ["playstation", "trophies"],
  (state) => state.observedAt,
);
