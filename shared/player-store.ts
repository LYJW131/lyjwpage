import { mirrorKey } from "@shared/storage";
import type { TrackEnrichment } from "@shared/track-enrichment";
import type { LocalNowPlaying } from "@shared/types";

export const TTL_MS = 24 * 60 * 60 * 1000;

export type PlayerDevice = "mac" | "omarchy";

export type StoredPlayer = {
  music: LocalNowPlaying;
  receivedAt: number;
  enrichment?: TrackEnrichment | null;
};

// 一格存最近一次：Mac 与 Omarchy 上的播放器谁后报算谁，和 HomePod 那一格互不覆盖。
export const mirror = mirrorKey<StoredPlayer>(
  ["player", "nowPlaying"],
  { ttlMs: TTL_MS },
);

export function playablePlayer(stored: StoredPlayer | null): StoredPlayer | null {
  if (!stored || stored.music.state === "stopped" || !stored.music.title) return null;
  return stored;
}

export async function getPlayerSnapshot() {
  return playablePlayer(await mirror.get());
}
