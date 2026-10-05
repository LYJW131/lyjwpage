import { lookupTrack, trackLookupFallback, type TrackLookup } from "@/lib/apple-music";
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

// 写入路径每段各自限时，上报器在等回执。目录查询最多串行 4 次 Apple 请求（3 个搜索词 + 1 次单曲详情）；
// 必需的目录查询与队列后两首并行，动态封面排在目录之后，最坏耗时是目录加动态封面两段之和。
export const CATALOG_TIMEOUT_MS = 2_000;
export const UPCOMING_TIMEOUT_MS = 2_000;
export const MOTION_TIMEOUT_MS = 2_000;
// 回执之后在 waitUntil 里跑，没人在等；目录加动态封面两段之和须留在 waitUntil 的 30 秒上限里，歌词预热与补写并行。
export const RETRY_TIMEOUT_MS = 8_000;
export const LYRICS_PREWARM_TIMEOUT_MS = 10_000;

export type EnrichmentBudget = { catalogMs: number; upcomingMs: number; motionMs: number };
export const WRITE_BUDGET: EnrichmentBudget = { catalogMs: CATALOG_TIMEOUT_MS, upcomingMs: UPCOMING_TIMEOUT_MS, motionMs: MOTION_TIMEOUT_MS };
export const RETRY_BUDGET: EnrichmentBudget = { catalogMs: RETRY_TIMEOUT_MS, upcomingMs: RETRY_TIMEOUT_MS, motionMs: RETRY_TIMEOUT_MS };

type TrackIdentity = Pick<LocalNowPlaying, "title" | "artist" | "album">;

export function trackKeyOf(track: TrackIdentity): string {
  return [track.title, track.artist, track.album].map(normalizeForMatch).join("|");
}

export function playableMusic(music: LocalNowPlaying | null | undefined): music is LocalNowPlaying {
  return Boolean(music && music.state !== "stopped" && music.title);
}

const TIMED_OUT = Symbol("timed out");

// 超时或失败打一条 warn 并返回 undefined（结果未知），与查过确定的结论区分开。
async function stage<T>(name: string, subject: string | null, timeoutMs: number, run: () => Promise<T>): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      run(),
      new Promise<typeof TIMED_OUT>((resolve) => { timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs); }),
    ]);
    if (result !== TIMED_OUT) return result;
    console.warn("[enrichment]", name, "timed out", `${timeoutMs}ms`, subject);
  } catch (error) {
    console.warn("[enrichment]", name, "failed", subject, error instanceof Error ? error.message : String(error));
  } finally {
    clearTimeout(timer);
  }
  return undefined;
}

// undefined 表示这次没查出结果（失败或超时），null 表示确定没有动态封面。
export async function resolveMotion(link: string | null, title: string | null, timeoutMs = MOTION_TIMEOUT_MS): Promise<TrackMotion | null | undefined> {
  const parsed = link ? parseAppleMusicUrl(link) : null;
  if (!parsed) return null;
  const result = await stage("motion", title, timeoutMs, () => resolveMotionArtwork(parsed));
  if (!result) return undefined;
  return result.hasMotion && result.videoUrl ? { videoUrl: result.videoUrl, colors: result.colors } : null;
}

export type EnrichmentOutcome = {
  enrichment: TrackEnrichment;
  catalogKnown: boolean;
  motionKnown: boolean;
};

async function enrich(
  music: LocalNowPlaying,
  upcomingTracks: readonly PlayingQueueTrack[],
  budget: EnrichmentBudget,
): Promise<EnrichmentOutcome> {
  const [found, ahead] = await Promise.all([
    stage("catalog", music.title, budget.catalogMs, () => lookupTrack(music)),
    Promise.all(upcomingTracks.map((track) => stage("upcoming", track.title, budget.upcomingMs, () => lookupTrack(track)))),
  ]);
  const lookup: TrackLookup = found ?? trackLookupFallback(music);
  const motion = lookup.songId ? await resolveMotion(lookup.link, music.title, budget.motionMs) : null;
  return {
    enrichment: {
      trackKey: trackKeyOf(music),
      id: lookup.id,
      link: lookup.link || null,
      songId: lookup.songId,
      artwork: lookup.artwork,
      hasLyrics: lookup.hasLyrics,
      upcomingSongIds: ahead.flatMap((hit) => (hit?.songId ? [hit.songId] : [])),
      motion: motion ?? null,
    },
    catalogKnown: found !== undefined,
    motionKnown: motion !== undefined,
  };
}

// 任何一段失败或超时都不阻止状态落库：没查到的部分存成未补全，由回执后的重试补写（catalogKnown / motionKnown）。
export async function enrichTrackOutcome(
  music: LocalNowPlaying | null | undefined,
  upcomingTracks: readonly PlayingQueueTrack[] = [],
  budget: EnrichmentBudget = WRITE_BUDGET,
): Promise<EnrichmentOutcome | null> {
  if (!playableMusic(music)) return null;
  return enrich(music, upcomingTracks, budget);
}

export async function enrichTrack(
  music: LocalNowPlaying | null | undefined,
  upcomingTracks: readonly PlayingQueueTrack[] = [],
  budget: EnrichmentBudget = WRITE_BUDGET,
): Promise<TrackEnrichment | null> {
  return (await enrichTrackOutcome(music, upcomingTracks, budget))?.enrichment ?? null;
}

export async function prewarmLyrics(enrichment: TrackEnrichment | null, title: string | null): Promise<void> {
  const songId = enrichment?.hasLyrics ? enrichment.songId : null;
  if (songId) await stage("lyrics", title, LYRICS_PREWARM_TIMEOUT_MS, () => resolveLyrics(songId));
}

// 补写只在比已存的那份多出东西时才生效：之前没查到目录，或同一首之前缺动态封面。
export function improvesEnrichment(next: TrackEnrichment, stored: TrackEnrichment | null | undefined): boolean {
  if (!next.songId) return false;
  if (!stored?.songId || stored.trackKey !== next.trackKey) return true;
  return stored.songId === next.songId && !stored.motion && Boolean(next.motion);
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
