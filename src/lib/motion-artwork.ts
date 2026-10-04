import { ampFetch, AppleUpstreamError, getWebToken } from "@/lib/apple-web-token";
import { cached } from "@/lib/apple-cache";
import type { AppleMusicParsed } from "@/lib/motion-artwork-url";


export interface MotionResult {
  hasMotion: boolean;
  videoUrl: string | null;
  colors: string[] | null;
  error?: string;
}

export const NO_MOTION: MotionResult = { hasMotion: false, videoUrl: null, colors: null };

const MOTION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
// 专辑发行后动态封面常常晚几天才补上，「没有」不是定论，不能和查到的结果一样长存。
const NO_MOTION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export function motionTtlMs(result: MotionResult): number {
  return result.hasMotion ? MOTION_TTL_MS : NO_MOTION_TTL_MS;
}

export function motionArtworkCacheKey(parsed: AppleMusicParsed): string {
  return parsed.albumId
    ? `motion-artwork:v2:${parsed.storefront}:album:${parsed.albumId}`
    : `motion-artwork:v2:${parsed.storefront}:song:${parsed.songId}`;
}

export async function resolveMotionArtwork(parsed: AppleMusicParsed): Promise<MotionResult> {
  return cached(motionArtworkCacheKey(parsed), motionTtlMs, () => loadMotionArtwork(parsed));
}

// 目录里没有这首或这张专辑（404）是确定答案，按「没有动态封面」缓存；其他错误照旧抛出，不缓存。
async function loadMotionArtwork(parsed: AppleMusicParsed): Promise<MotionResult> {
  try {
    return await lookupMotionArtwork(parsed);
  } catch (error) {
    if (error instanceof AppleUpstreamError && error.status === 404) return NO_MOTION;
    throw error;
  }
}

async function lookupMotionArtwork(parsed: AppleMusicParsed): Promise<MotionResult> {
  const token = await getWebToken();

  let albumId = parsed.albumId;
  if (!albumId && parsed.songId) {
    albumId = (await fetchAlbumIdBySong(parsed.storefront, parsed.songId, token)) ?? undefined;
    if (!albumId) return NO_MOTION;
  }
  if (!albumId) return NO_MOTION;

  const motion = await fetchSquareMotionArtwork(parsed.storefront, albumId, token);
  if (!motion) return NO_MOTION;

  return { hasMotion: true, videoUrl: motion.videoUrl, colors: motion.colors };
}

async function fetchAlbumIdBySong(
  storefront: string,
  songId: string,
  token: string,
): Promise<string | null> {
  const json = await ampFetch<{
    data?: Array<{
      relationships?: {
        albums?: {
          data?: Array<{ id?: string }>;
        };
      };
    }>;
  }>(
    `https://amp-api.music.apple.com/v1/catalog/${storefront}/songs/${songId}?include=albums`,
    token,
  );
  return json?.data?.[0]?.relationships?.albums?.data?.[0]?.id ?? null;
}

interface EditorialVideoItem {
  video?: string;
  previewFrame?: {
    bgColor?: string;
    textColor1?: string;
    textColor2?: string;
    textColor3?: string;
    textColor4?: string;
  };
}

async function fetchSquareMotionArtwork(
  storefront: string,
  albumId: string,
  token: string,
): Promise<{ videoUrl: string; colors: string[] | null } | null> {
  const result = await ampFetch<{
    data?: Array<{
      attributes?: {
        editorialVideo?: {
          motionDetailSquare?: EditorialVideoItem;
          motionSquareVideo1x1?: EditorialVideoItem;
        };
      };
    }>;
  }>(
    `https://amp-api.music.apple.com/v1/catalog/${storefront}/albums/${albumId}?extend=editorialVideo`,
    token,
  );

  const videoData = result?.data?.[0]?.attributes?.editorialVideo;
  if (!videoData) return null;

  const squareClip = videoData.motionDetailSquare?.video
    ? videoData.motionDetailSquare
    : videoData.motionSquareVideo1x1;

  if (!squareClip?.video) return null;

  const pf = squareClip.previewFrame;
  const colors = pf
    ? ([pf.bgColor, pf.textColor1, pf.textColor2, pf.textColor3, pf.textColor4].filter(
        Boolean,
      ) as string[])
    : null;

  return {
    videoUrl: squareClip.video,
    colors: colors && colors.length > 0 ? colors : null,
  };
}
