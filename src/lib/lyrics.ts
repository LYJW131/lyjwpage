import { readAppleMusicCredentials } from "@/lib/apple-music-credentials";
import { ampFetch, AppleUpstreamError, getWebToken } from "@/lib/apple-web-token";
import { get, put } from "@/lib/cache";
import { parseLyricsTtml, type LyricLine } from "@/lib/lyrics-ttml";


export type LyricsResult = {
  lines: LyricLine[];
  songwriters?: string[];
  error?: string;
};

export const NO_LYRICS: LyricsResult = { lines: [] };

const LYRICS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// amp-api 的 404 无法区分无歌词与订阅身份暂不可用，负缓存不能按成功结果长期保存。
const NO_LYRICS_TTL_MS = 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 5_000;

const inflight = new Map<string, Promise<LyricsResult>>();

function storefront(): string {
  return (process.env.APPLE_MUSIC_STOREFRONT?.trim() || "cn").toLowerCase();
}

export function lyricsCacheKey(songId: string): string {
  return `lyrics:v4:${storefront()}:${songId}`;
}

export async function resolveLyrics(songId: string): Promise<LyricsResult> {
  if (!/^\d{1,20}$/.test(songId)) throw new AppleUpstreamError("songId 不是目录 ID");
  const id = songId;
  const cacheKey = lyricsCacheKey(id);

  const [hit, failure] = await Promise.all([
    get<LyricsResult>(cacheKey),
    get<{ message: string }>(`neg:${cacheKey}`),
  ]);
  if (hit !== undefined) return hit;
  if (failure) throw new AppleUpstreamError(failure.message);

  const running = inflight.get(cacheKey);
  if (running) return running;

  const promise = (async () => {
    try {
      const result = await loadLyrics(id);
      await put(cacheKey, result, result.lines.length ? LYRICS_TTL_MS : NO_LYRICS_TTL_MS);
      return result;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      await put(`neg:${cacheKey}`, { message: err.message }, NEGATIVE_TTL_MS);
      throw err;
    } finally {
      inflight.delete(cacheKey);
    }
  })();

  inflight.set(cacheKey, promise);
  return promise;
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
