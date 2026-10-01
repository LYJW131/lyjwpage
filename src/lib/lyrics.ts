import { readAppleMusicCredentials } from "@/lib/apple-music-credentials";
import { ampFetch, AppleUpstreamError, getWebToken } from "@/lib/apple-web-token";
import { cached } from "@/lib/apple-cache";
import { parseLyricsTtml, type LyricLine } from "@/lib/lyrics-ttml";


export type LyricsResult = {
  lines: LyricLine[];
  songwriters?: string[];
  error?: string;
};

export const NO_LYRICS: LyricsResult = { lines: [] };

const LYRICS_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// amp-api 的 404 无法区分无歌词与订阅身份暂不可用，负缓存不能按成功结果长期保存。
const NO_LYRICS_TTL_MS = 60 * 60 * 1000;

export function lyricsTtlMs(result: LyricsResult): number {
  return result.lines.length ? LYRICS_TTL_MS : NO_LYRICS_TTL_MS;
}

function storefront(): string {
  return (process.env.APPLE_MUSIC_STOREFRONT?.trim() || "cn").toLowerCase();
}

export function lyricsCacheKey(songId: string): string {
  return `lyrics:v4:${storefront()}:${songId}`;
}

export async function resolveLyrics(songId: string): Promise<LyricsResult> {
  if (!/^\d{1,20}$/.test(songId)) throw new AppleUpstreamError("songId 不是目录 ID");
  return cached(lyricsCacheKey(songId), lyricsTtlMs, () => loadLyrics(songId));
}

async function loadLyrics(songId: string): Promise<LyricsResult> {
  const credentials = await readAppleMusicCredentials();
  if (!credentials.ok) {
    // 没有订阅身份就别去问：问了也是那个分不清的 404，还会把它缓存成「没有」
    throw new AppleUpstreamError(
      credentials.reason === "storage-unreachable"
        ? "读不到 Apple Music 凭据 —— Storage 连不上"
        : "没有 Mac 上报器推来的 Apple Music 凭据",
    );
  }
  const token = await getWebToken();
  const headers = { "Media-User-Token": credentials.credentials.musicUserToken };

  for (const kind of ["syllable-lyrics", "lyrics"] as const) {
    let json: { data?: Array<{ attributes?: { ttml?: string } }> };
    try {
      json = await ampFetch(
        `https://amp-api.music.apple.com/v1/catalog/${storefront()}/songs/${songId}/${kind}`,
        token,
        headers,
      );
    } catch (error) {
      if (error instanceof AppleUpstreamError && error.status === 404) continue;
      throw error;
    }
    const ttml = json?.data?.[0]?.attributes?.ttml;
    if (!ttml) continue;
    const { lines, songwriters } = parseLyricsTtml(ttml);
    if (lines.length) return { lines, songwriters };
  }
  return NO_LYRICS;
}
