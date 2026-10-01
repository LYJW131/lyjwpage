import { appleDeveloperToken } from "@/lib/apple-developer-token";
import { readAppleMusicCredentials } from "@/lib/apple-music-credentials";
import {
  catalogSearchTerms,
  normalizeForMatch,
  pickCatalogHit,
  type CatalogSong,
} from "@/lib/apple-music-lookup";
import { cached } from "@/lib/apple-cache";


export type Credentials = {
  developerToken: string;
  userToken: string;
};

export function appleStorefront(): string {
  return (process.env.APPLE_MUSIC_STOREFRONT?.trim() || "cn").toLowerCase();
}

export async function resolveCredentials(): Promise<Credentials> {
  const result = await readAppleMusicCredentials();
  if (!result.ok) {
    throw new Error(
      result.reason === "storage-unreachable"
        ? "读不到 Apple Music 凭据 —— Storage 连不上，凭据本身可能还在"
        : "没有收到 Mac 上报器的 Apple Music 凭据 —— 在上报器的设置里授权 Apple Music",
    );
  }
  return {
    developerToken: await appleDeveloperToken(),
    userToken: result.credentials.musicUserToken,
  };
}

const UPSTREAM_TIMEOUT_MS = 10_000;

export async function appleFetchRaw<T>(url: string, credentials: Credentials): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${credentials.developerToken}`,
      "Music-User-Token": credentials.userToken,
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
  });

  if (!response.ok) {
    const body = (await response.text()).slice(0, 300);
    // 两个状态码指向两台机器：401 是 Worker 自签那份不被认，403 是 Mac 推来的 user token 不再有效
    if (response.status === 401) {
      throw new Error(`Apple Music 拒绝了 Worker 自签的 developer token（401，检查 APPLE_MUSIC_TEAM_ID / KEY_ID / PRIVATE_KEY 是否同一套）：${body}`);
    }
    if (response.status === 403) {
      throw new Error(`Music-User-Token 已失效，需要在 Mac 上报器里重新授权 Apple Music（403）：${body}`);
    }
    throw new Error(`Apple Music 返回 ${response.status}：${body}`);
  }

  return (await response.json()) as T;
}

const TRACK_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
// 同一曲目可能在多个专辑中重复收录；截短候选会漏掉正确版本。
const SEARCH_LIMIT = 25;

export type TrackLookup = {
  link: string;
  artwork: string | null;
  id: string | null;
  songId: string | null;
  hasLyrics: boolean;
};

// 专辑名必须进 key：同名同艺人但不同专辑是完全不同的链接
// 缓存形状或匹配策略变化必须换键；旧字符串的 .link 是内建方法，不能当作新对象读取。
export function trackLookupCacheKey(track: { title: string | null; artist: string | null; album: string | null }): string {
  return "apple-music:track-lookup:v10:" + [track.title, track.artist, track.album].map(normalizeForMatch).join(":");
}

export async function resolveTrackLookup(track: {
  title: string | null;
  artist: string | null;
  album: string | null;
}): Promise<TrackLookup> {
  if (!track.title) return { link: "", artwork: null, id: null, songId: null, hasLyrics: false };

  const terms = catalogSearchTerms(track.title, track.artist, track.album);
  const searchUrl = `https://music.apple.com/search?term=${encodeURIComponent(terms.at(-1) ?? track.title)}`;

  const cacheKey = trackLookupCacheKey(track);

  try {
    const exact = await cached<TrackLookup>(cacheKey, TRACK_LINK_TTL_MS, async () => {
      const credentials = await resolveCredentials();
      const storefront = appleStorefront();
      let hit: CatalogSong | undefined;

      for (const term of terms) {
        const url =
          `https://api.music.apple.com/v1/catalog/${storefront}/search` +
          `?term=${encodeURIComponent(term)}&types=songs&limit=${SEARCH_LIMIT}&relate=albums`;
        const json = await appleFetchRaw<{
          results?: { songs?: { data?: CatalogSong[] } };
        }>(url, credentials);
        hit = pickCatalogHit(json.results?.songs?.data ?? [], {
          title: track.title!,
          artist: track.artist,
          album: track.album,
        });
        if (hit) break;
      }

      let albumId = hit?.relationships?.albums?.data?.[0]?.id ?? null;
      if (hit?.id && !albumId) {
        const detail = await appleFetchRaw<{ data?: CatalogSong[] }>(
          `https://api.music.apple.com/v1/catalog/${storefront}/songs/${hit.id}?relate=albums`,
          credentials,
        );
        albumId = detail.data?.[0]?.relationships?.albums?.data?.[0]?.id ?? null;
      }

      // link 存空串而不是 null：cached 用 undefined 判未命中，空串才能把
      // 「搜过了但没匹配上」这个结论也缓存住，不然每次都会重搜一遍
      return {
        link: hit?.attributes?.url ?? "",
        artwork: hit?.attributes?.artwork?.url ?? null,
        id: albumId,
        songId: hit?.id ?? null,
        hasLyrics: hit?.attributes?.hasLyrics === true,
      };
    });
    return {
      link: exact.link || searchUrl,
      artwork: exact.artwork,
      id: exact.id,
      songId: exact.songId,
      hasLyrics: exact.hasLyrics,
    };
  } catch (error) {
    console.warn("[track-lookup]", track.title, error instanceof Error ? error.message : String(error));
    return { link: searchUrl, artwork: null, id: null, songId: null, hasLyrics: false };
  }
}
