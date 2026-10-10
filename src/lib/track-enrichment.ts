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

export function upcomingKeyOf(tracks: readonly PlayingQueueTrack[]): string {
  return JSON.stringify(tracks.map(trackKeyOf));
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
  upcomingKnown: boolean;
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
    upcomingKnown: ahead.every((hit) => hit !== undefined),
    motionKnown: motion !== undefined,
  };
}

// 任何一段失败或超时都不阻止状态落库：没查到的部分存成未补全，由回执后的重试补写（catalogKnown / upcomingKnown / motionKnown）。
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

// upcomingSongIds 属于算它时的那份队列，同一首歌期间队列可以变：queueMatches 为假（不是同一份队列）时不动已存的队列 ID。
export function mergeEnrichment(
  stored: TrackEnrichment | null | undefined,
  next: TrackEnrichment,
  queueMatches: boolean,
): TrackEnrichment | null {
  const same = stored?.trackKey === next.trackKey ? stored : null;
  if (!same) return next.songId ? { ...next, upcomingSongIds: queueMatches ? next.upcomingSongIds : [] } : null;
  const catalog = next.songId && !same.songId ? next : same;
  const motion = catalog === same && same.songId === next.songId && !same.motion && next.motion ? next.motion : catalog.motion;
  const upcomingSongIds = queueMatches && next.upcomingSongIds.length > same.upcomingSongIds.length
    ? next.upcomingSongIds
    : same.upcomingSongIds;
  if (catalog === same && motion === same.motion && upcomingSongIds === same.upcomingSongIds) return null;
  return { ...catalog, motion, upcomingSongIds };
}

// 同一曲目这次目录没查到（失败、超时）时沿用已存的目录。动态封面的 null 同时表示「确定没有」和「这次没查出」，
// 同一 songId 上不能用 null 换掉已经存下的视频；换了 songId 才丢掉旧视频。队列 ID 跟本次上报的队列走，只有队列没变且已存的查出更多时才沿用。
export function keepEnrichment(
  music: LocalNowPlaying | null | undefined,
  next: TrackEnrichment | null | undefined,
  previous: TrackEnrichment | null | undefined,
  queueMatches: boolean,
): TrackEnrichment | null {
  if (!playableMusic(music)) return next ?? null;
  const same = previous?.trackKey === trackKeyOf(music) ? previous : null;
  if (!next) return same?.songId ? same : null;
  if (!same) return next;
  const catalog = next.songId || !same.songId ? next : same;
  const upcomingSongIds = queueMatches && same.upcomingSongIds.length > next.upcomingSongIds.length
    ? same.upcomingSongIds
    : next.upcomingSongIds;
  const motion = catalog.motion ?? (catalog.songId != null && catalog.songId === same.songId ? same.motion : null);
  if (catalog === next && upcomingSongIds === next.upcomingSongIds && motion === next.motion) return next;
  return { ...catalog, upcomingSongIds, motion: motion ?? null };
}

export type ShownLookup = {
  key: string;
  id: string | null;
  songId: string;
  link: string | null;
  upcomingSongIds: string[];
  hasLyrics: boolean;
  motion: TrackMotion | null;
};

// 卡片只在第一次看见这个 songId 时记下解析结果。之后同一首查出视频，要补进这份记录；换曲才整份换掉。
export function rememberLookup(
  trackKey: string | null,
  live: {
    id: string | null;
    songId: string | null;
    link: string | null;
    upcomingSongIds: string[];
    hasLyrics: boolean;
    motion: TrackMotion | null;
  } | null | undefined,
  previous: ShownLookup | null,
): ShownLookup | null {
  if (!live?.songId || !trackKey) return previous;
  if (!previous || previous.key !== trackKey || previous.songId !== live.songId) {
    return {
      key: trackKey,
      id: live.id,
      songId: live.songId,
      link: live.link,
      upcomingSongIds: live.upcomingSongIds,
      hasLyrics: live.hasLyrics,
      motion: live.motion,
    };
  }
  if (live.motion && previous.motion?.videoUrl !== live.motion.videoUrl) return { ...previous, motion: live.motion };
  return previous;
}

// 有 songId 时优先用这次的视频；这次是 null 就留着同一首已经显示过的。换了 songId 禁止沿用。
export function shownMotion(
  live: { songId: string | null; motion: TrackMotion | null } | null | undefined,
  latched: { songId: string; motion: TrackMotion | null } | null,
): TrackMotion | null {
  if (live?.songId) return live.motion ?? (latched?.songId === live.songId ? latched.motion : null);
  return latched?.motion ?? null;
}

export function heldVideoUrl(
  stored: TrackMotion | null | undefined,
  fetched: { hasMotion: boolean; videoUrl: string | null } | null | undefined,
): string | null {
  if (stored?.videoUrl) return stored.videoUrl;
  return fetched?.hasMotion ? fetched.videoUrl : null;
}

export function withHeldMotion<T extends { motion?: TrackMotion | null }>(item: T, held: TrackMotion | null | undefined): T {
  if (item.motion?.videoUrl || !held?.videoUrl) return item;
  return { ...item, motion: held };
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
