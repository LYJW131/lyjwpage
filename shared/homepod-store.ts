
import { mirrorKey } from "@/lib/storage";
import type { LocalNowPlaying } from "@/lib/types";

export const TTL_MS = 24 * 60 * 60 * 1000;

export type StoredHomePod = {
  music: LocalNowPlaying;
  receivedAt: number;
};

/** 读写规则见 lib/storage 的 mirrorKey */
export const mirror = mirrorKey<StoredHomePod>(
  ["homepod", "nowPlaying"],
  (state) => state.receivedAt,
  { ttlMs: TTL_MS },
);
