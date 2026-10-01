import { ampFetch, getWebToken } from "@/lib/apple-web-token";
import { cached } from "@/lib/apple-cache";
import type { AppleMusicParsed } from "@/lib/motion-artwork-url";


export interface MotionResult {
  hasMotion: boolean;
  videoUrl: string | null;
  colors: string[] | null;
  error?: string;
}

export const NO_MOTION: MotionResult = { hasMotion: false, videoUrl: null, colors: null };

const MOTION_TTL_MS = 24 * 60 * 60 * 1000;
const NO_MOTION_TTL_MS = 60 * 60 * 1000;

export function motionArtworkCacheKey(parsed: AppleMusicParsed): string {
  return parsed.albumId
    ? `motion-artwork:v1:${parsed.storefront}:album:${parsed.albumId}`
    : `motion-artwork:v1:${parsed.storefront}:song:${parsed.songId}`;
}

export async function resolveMotionArtwork(parsed: AppleMusicParsed): Promise<MotionResult> {
  return cached(motionArtworkCacheKey(parsed), (result: MotionResult) => (result.hasMotion ? MOTION_TTL_MS : NO_MOTION_TTL_MS), () => loadMotionArtwork(parsed));
}

async function loadMotionArtwork(parsed: AppleMusicParsed): Promise<MotionResult> {
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
