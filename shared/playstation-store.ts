import { mirrorKey } from "@shared/storage";
import type {
  PlaystationPlayingPayload,
  PlaystationPowerPayload,
  PlaystationPresencePayload,
  TrophiesPayload,
} from "@shared/types";

export const TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const presenceMirror = mirrorKey<PlaystationPresencePayload>(
  ["playstation", "presence"],
  { ttlMs: TTL_MS },
);

export const powerMirror = mirrorKey<PlaystationPowerPayload>(
  ["playstation", "power"],
);

export const playedGamesMirror = mirrorKey<PlaystationPlayingPayload>(
  ["playstation", "playedGames"],
  { ttlMs: TTL_MS },
);

// 奖杯目录可能数周不变，不能随 presence 的 TTL 过期。
export const trophiesMirror = mirrorKey<TrophiesPayload>(
  ["playstation", "trophies"],
);
