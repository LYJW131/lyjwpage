import { LYRICS_PATH, MOTION_ARTWORK_PATH } from "@shared/apple-music-paths";
import { lyricsCacheKey, lyricsTtlMs, resolveLyrics } from "@shared/lyrics";
import type { LyricsResult } from "@shared/lyrics-ttml";
import { motionArtworkCacheKey, motionTtlMs, NO_MOTION, resolveMotionArtwork, type MotionResult } from "@shared/motion-artwork";
import { parseAppleMusicUrl } from "@shared/motion-artwork-url";

export type LyricsResponse = LyricsResult & { songId: string | null };
export type MotionResponse = MotionResult & { link: string | null };

export type AppleLookup = {
  GET(request: Request): Promise<Response>;
  edgeCacheKey(request: Request): string | null;
};

function requestedSong(request: Request): string {
  return new URL(request.url).searchParams.get("song")?.trim() ?? "";
}

const validSong = (song: string): boolean => /^\d{1,20}$/.test(song);

const lyrics: AppleLookup = {
  edgeCacheKey(request) {
    const requested = requestedSong(request);
    return validSong(requested) ? lyricsCacheKey(requested) : null;
  },

  async GET(request) {
    const requested = requestedSong(request);
    if (!validSong(requested)) {
      return jsonResponse(
        { songId: null, lines: [], error: 'Missing or invalid "song" query parameter' },
        400,
      );
    }
    try {
      const result = await resolveLyrics(requested);
      return jsonResponse(
        { songId: requested, ...result },
        200,
        Math.round(lyricsTtlMs(result) / 1000),
      );
    } catch (error) {
      console.error("[lyrics]", error);
      return jsonResponse({ songId: requested, lines: [] }, 500);
    }
  },
};

function requestedLink(request: Request): string {
  return new URL(request.url).searchParams.get("url")?.trim() ?? "";
}

const motionArtwork: AppleLookup = {
  // 响应回显原始 link，缓存键必须包含原链接，不能只按解析后的身份合并。
  edgeCacheKey(request) {
    const requested = requestedLink(request);
    const parsed = requested ? parseAppleMusicUrl(requested) : null;
    return parsed ? `${motionArtworkCacheKey(parsed)}:${encodeURIComponent(requested)}` : null;
  },

  async GET(request) {
    const requested = requestedLink(request);
    const parsed = requested ? parseAppleMusicUrl(requested) : null;
    if (!parsed) {
      return jsonResponse(
        { link: requested || null, ...NO_MOTION, error: "Missing or invalid Apple Music URL" },
        400,
      );
    }
    try {
      const result = await resolveMotionArtwork(parsed);
      return jsonResponse({ link: requested, ...result }, 200, Math.round(motionTtlMs(result) / 1000));
    } catch (error) {
      console.error("[motion-artwork]", error);
      return jsonResponse({ link: requested, ...NO_MOTION }, 500);
    }
  },
};

function jsonResponse(data: LyricsResponse | MotionResponse, status = 200, cacheTtl = 0): Response {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control":
        cacheTtl > 0
          ? `public, max-age=${cacheTtl}, s-maxage=${cacheTtl}`
          : "no-store, no-cache, must-revalidate",
    },
  });
}

export const APPLE_LOOKUPS: ReadonlyMap<string, AppleLookup> = new Map([
  [LYRICS_PATH, lyrics],
  [MOTION_ARTWORK_PATH, motionArtwork],
]);
