import { resolveTrackLookup } from "@/lib/apple-music";
import { normalizeForMatch } from "@/lib/apple-music-lookup";
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

// 每段单独计时：回执路径上最多等「目录 + 动态封面」两段；歌词预热不在这里，由调用方放到回执之后。
export const ENRICHMENT_TIMEOUT_MS = 2_000;

export type EnrichmentOptions = {
  timeoutMs?: number;
  // 超时的那段请求继续跑完，缓存写才落得下；Worker 里由调用方接到 waitUntil。
  background?: (work: Promise<void>) => void;
};

type TrackIdentity = Pick<LocalNowPlaying, "title" | "artist" | "album">;

export function trackKeyOf(track: TrackIdentity): string {
  return [track.title, track.artist, track.album].map(normalizeForMatch).join("|");
}

export function playableMusic(music: LocalNowPlaying | null | undefined): music is LocalNowPlaying {
  return Boolean(music && music.state !== "stopped" && music.title);
}

async function motionOf(link: string | null): Promise<TrackMotion | null> {
  const parsed = link ? parseAppleMusicUrl(link) : null;
  if (!parsed) return null;
  const result = await resolveMotionArtwork(parsed);
  return result.hasMotion && result.videoUrl ? { videoUrl: result.videoUrl, colors: result.colors } : null;
}

export function resolveMotion(link: string | null): Promise<TrackMotion | null> {
  return motionOf(link).catch(() => null);
}

function reason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const TIMED_OUT = Symbol("timed-out");

async function segment<T>(label: string, work: Promise<T>, fallback: T, options: EnrichmentOptions): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), options.timeoutMs ?? ENRICHMENT_TIMEOUT_MS);
  });
  try {
    const result = await Promise.race([work, timeout]);
    if (result !== TIMED_OUT) return result;
    console.warn("[enrichment] timeout", label);
    const settled = work.then(() => undefined, (error: unknown) => console.warn("[enrichment]", label, reason(error)));
    options.background?.(settled);
    return fallback;
  } catch (error) {
    console.warn("[enrichment]", label, reason(error));
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

async function enrich(
  music: LocalNowPlaying,
  upcomingTracks: readonly PlayingQueueTrack[],
  options: EnrichmentOptions,
): Promise<TrackEnrichment | null> {
  const [lookup, ahead] = await Promise.all([
    segment("track", resolveTrackLookup(music), null, options),
    segment("upcoming", Promise.all(upcomingTracks.map((track) => resolveTrackLookup(track))), [], options),
  ]);
  if (!lookup) return null;
  const motion = await segment("motion", motionOf(lookup.songId ? lookup.link : null), null, options);
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

// 目录那段失败或超时就存成未补全，等同一曲目的下一封上报再补；队列、动态封面那两段失败只丢自己。
export function enrichTrack(
  music: LocalNowPlaying | null | undefined,
  upcomingTracks: readonly PlayingQueueTrack[] = [],
  options: EnrichmentOptions = {},
): Promise<TrackEnrichment | null> {
  if (!playableMusic(music)) return Promise.resolve(null);
  return enrich(music, upcomingTracks, options);
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
