import { statusEnvelope } from "@/lib/api";
import { resolveLyrics, type LyricsResult } from "@/lib/lyrics";
import {
  homeLoader,
  statusLoaders,
  type HomePayloadOf,
  type StatusLoaderKey,
} from "@/lib/status-loaders";
import type { StatusResponse } from "@/lib/types";

export type HomeSnapshot = {
  [K in StatusLoaderKey]: StatusResponse<HomePayloadOf<K>>;
} & { lyrics: LyricsResult | null };

export async function publicHomeSnapshot(): Promise<HomeSnapshot> {
  const keys = Object.keys(statusLoaders) as StatusLoaderKey[];
  const entries = await Promise.all(
    keys.map(async (key) => [key, await statusEnvelope(homeLoader(key))] as const),
  );
  const fields = Object.fromEntries(entries) as {
    [K in StatusLoaderKey]: StatusResponse<HomePayloadOf<K>>;
  };

  let lyrics: LyricsResult | null = null;
  const nowListening = fields.nowListening;
  if (
    nowListening.ok &&
    !nowListening.data.idle &&
    nowListening.data.hasLyrics &&
    nowListening.data.songId
  ) {
    try {
      lyrics = await resolveLyrics(nowListening.data.songId);
    } catch (error) {
      console.error("[home lyrics]", error);
    }
  }

  return { ...fields, lyrics };
}
