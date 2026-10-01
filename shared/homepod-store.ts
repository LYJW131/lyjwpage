import { mirrorKey } from "@/lib/storage";
import type { TrackEnrichment } from "@/lib/track-enrichment";
import type { LocalNowPlaying } from "@/lib/types";

export const TTL_MS = 24 * 60 * 60 * 1000;

export type StoredHomePod = {
  music: LocalNowPlaying;
  receivedAt: number;
  enrichment?: TrackEnrichment | null;
};

export const mirror = mirrorKey<StoredHomePod>(
  ["homepod", "nowPlaying"],
  (state) => state.receivedAt,
  { ttlMs: TTL_MS },
);
