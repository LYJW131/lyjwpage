import { resolveTrackLookup } from "@/lib/apple-music";
import { normalizeForMatch } from "@/lib/apple-music-lookup";
import { resolveLyrics } from "@/lib/lyrics";
import { resolveMotionArtwork } from "@/lib/motion-artwork";
import { parseAppleMusicUrl } from "@/lib/motion-artwork-url";
import type { NowListeningCandidate } from "@/lib/now-listening";
import type { PlayingQueueTrack } from "@/lib/playing-queue";
import type { LocalNowPlaying, TrackMotion } from "@/lib/types";

// 上报只带本地播放信息；目录字段在写入时补全并随状态落库，读取与推送只读存好的这份。
export type TrackEnrichment = {
  trackKey: string;
  id: string | null;
  link: string | null;
  songId: string | null;
  artwork: string | null;
  hasLyrics: boolean;
  upcomingSongIds: string[];
  motion: TrackMotion | null;
};

export const ENRICHMENT_TIMEOUT_MS = 8_000;

type TrackIdentity = Pick<LocalNowPlaying, "title" | "artist" | "album">;

export function trackKeyOf(track: TrackIdentity): string {
  return [track.title, track.artist, track.album].map(normalizeForMatch).join("|");
}

export function playableMusic(music: LocalNowPlaying | null | undefined): music is LocalNowPlaying {
  return Boolean(music && music.state !== "stopped" && music.title);
}

export async function resolveMotion(link: string | null): Promise<TrackMotion | null> {
  const parsed = link ? parseAppleMusicUrl(link) : null;
  if (!parsed) return null;
  const result = await resolveMotionArtwork(parsed).catch(() => null);
  return result?.hasMotion && result.videoUrl ? { videoUrl: result.videoUrl, colors: result.colors } : null;
}

async function enrich(music: LocalNowPlaying, upcomingTracks: readonly PlayingQueueTrack[]): Promise<TrackEnrichment> {
  const [lookup, ...ahead] = await Promise.all([
    resolveTrackLookup(music),
    ...upcomingTracks.map((track) => resolveTrackLookup(track)),
  ]);
  const [motion] = await Promise.all([
    resolveMotion(lookup.songId ? lookup.link : null),
    lookup.songId && lookup.hasLyrics ? resolveLyrics(lookup.songId).catch(() => null) : null,
  ]);
  return {
    trackKey: trackKeyOf(music),
    id: lookup.id,
    link: lookup.link || null,
    songId: lookup.songId,
    artwork: lookup.artwork,
    hasLyrics: lookup.hasLyrics,
    upcomingSongIds: ahead.flatMap((hit) => (hit.songId ? [hit.songId] : [])),
    motion,
  };
}

// 补全失败或超时不阻止状态落库，存成未补全，等同一曲目的下一封上报再补。
export async function enrichTrack(
  music: LocalNowPlaying | null | undefined,
  upcomingTracks: readonly PlayingQueueTrack[] = [],
  timeoutMs = ENRICHMENT_TIMEOUT_MS,
): Promise<TrackEnrichment | null> {
  if (!playableMusic(music)) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      enrich(music, upcomingTracks),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs); }),
    ]);
  } catch (error) {
    console.warn("[enrichment]", error instanceof Error ? error.message : String(error));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// 同一曲目这次没查到（失败、超时）时沿用已存的那份，不让一次失败抹掉卡片的链接与封面。
export function keepEnrichment(
  music: LocalNowPlaying | null | undefined,
  next: TrackEnrichment | null | undefined,
  previous: TrackEnrichment | null | undefined,
): TrackEnrichment | null {
  if (next?.songId || !playableMusic(music)) return next ?? null;
  return previous?.songId && previous.trackKey === trackKeyOf(music) ? previous : next ?? null;
}

export function candidateFrom(
  music: LocalNowPlaying | null | undefined,
  receivedAt: number,
  enrichment: TrackEnrichment | null | undefined,
): NowListeningCandidate | null {
  if (!playableMusic(music)) return null;
  const known = enrichment && enrichment.trackKey === trackKeyOf(music) ? enrichment : null;
  return {
    music: known?.artwork ? { ...music, artworkUrl: known.artwork } : music,
    receivedAt,
    id: known?.id ?? null,
    link: known?.link ?? null,
    songId: known?.songId ?? null,
    upcomingSongIds: known?.upcomingSongIds ?? [],
    hasLyrics: known?.hasLyrics ?? false,
    motion: known?.motion ?? null,
  };
}
