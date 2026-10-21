import { LYRICS_PATH, MOTION_ARTWORK_PATH } from "@shared/apple-music-paths";
import { lyricsTtlMs, storedLyrics } from "@shared/lyrics";
import type { LyricsResult } from "@shared/lyrics-ttml";
import { motionTtlMs, NO_MOTION, resolveMotionArtwork, type MotionResult } from "@shared/motion-artwork";
import { parseAppleMusicUrl } from "@shared/motion-artwork-url";

export type LyricsResponse = LyricsResult & { songId: string | null };
export type MotionResponse = MotionResult & { link: string | null };

export type AppleLookup = {
  GET(request: Request): Promise<Response>;
};

function requestedSong(request: Request): string {
  return new URL(request.url).searchParams.get("song")?.trim() ?? "";
}

const validSong = (song: string): boolean => /^\d{1,20}$/.test(song);

const lyrics: AppleLookup = {
  async GET(request) {
    const requested = requestedSong(request);
    if (!validSong(requested)) {
      return jsonResponse(
        { songId: null, lines: [], error: 'Missing or invalid "song" query parameter' },
        400,
      );
    }
    // 公开路径只读写入时预热的缓存，不现查 Apple：查歌词用的是 lyjw 的订阅身份，任意曲目 ID 都现查等于把它借给所有人。
    // 没命中回 404 且不缓存，正在听的那首预热完成前浏览器会按失败重试。
    const result = await storedLyrics(requested);
    if (!result) return jsonResponse({ songId: requested, lines: [], error: "Lyrics are only served for tracks lyjw is playing" }, 404);
    return jsonResponse(
      { songId: requested, ...result },
      200,
      Math.round(lyricsTtlMs(result) / 1000),
    );
  },
};

function requestedLink(request: Request): string {
  return new URL(request.url).searchParams.get("url")?.trim() ?? "";
}

const motionArtwork: AppleLookup = {
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
