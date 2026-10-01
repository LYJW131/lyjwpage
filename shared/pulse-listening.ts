import { homePodTrackEnd, homePodVisibleAt, homePodVisibleUntil } from "@/lib/homepod-store";
import { offlineByLiveness, type Liveness } from "@/lib/reporter-liveness";
import type { LocalNowPlaying, RecentTrack } from "@/lib/types";
import { PULSE_STATE_HOLD_MS, pulseText, type ListeningFacts, type ObservationHold } from "@shared/pulse-timeline";

export function listeningObservation(
  input: {
    mac: LocalNowPlaying | null;
    macObserved: boolean;
    homePod: { music: LocalNowPlaying; receivedAt: number } | null;
  },
  live: Liveness,
  now: number,
): { facts: ListeningFacts; hold: ObservationHold } | null {
  const macVisible = input.macObserved && !offlineByLiveness(live, now);
  const mac = macVisible && input.mac?.title ? input.mac : null;
  const homePod = input.homePod && input.homePod.music.title && homePodVisibleAt(input.homePod, now) ? input.homePod : null;
  const macHold: ObservationHold = { until: now + PULSE_STATE_HOLD_MS };
  const homePodHold = (stored: { music: LocalNowPlaying; receivedAt: number }): ObservationHold =>
    ({ until: homePodVisibleUntil(stored), endsBy: homePodTrackEnd(stored) });
  if (mac?.state === "playing") return { facts: playingFacts(mac), hold: macHold };
  if (homePod?.music.state === "playing") return { facts: playingFacts(homePod.music), hold: homePodHold(homePod) };
  if (mac?.state === "paused") return { facts: playingFacts(mac), hold: macHold };
  if (homePod?.music.state === "paused") return { facts: playingFacts(homePod.music), hold: homePodHold(homePod) };
  if (!macVisible && !homePod) return null;
  const idle: ListeningFacts = { state: "idle", source: null, title: null, artist: null, album: null, trackId: null };
  return { facts: idle, hold: macVisible || !homePod ? macHold : homePodHold(homePod) };
}

function playingFacts(music: LocalNowPlaying): ListeningFacts {
  return {
    state: music.state === "playing" ? "playing" : "paused",
    source: music.source === "homepod" ? "homepod" : "mac",
    title: pulseText(music.title),
    artist: pulseText(music.artist),
    album: pulseText(music.album),
    trackId: pulseText(music.trackId, 80),
  };
}

// Apple 最近播放列表不给播放时刻，只能把变化定位在两次刷新之间，不能当作此刻播放。
export type ListeningTrace = {
  since: number;
  t: number;
  title: string | null;
  artist: string | null;
  album: string | null;
  itemId: string | null;
};
export const LISTENING_TRACE_CAP = 2000;

// 最近播放每轮刷新只能定位到两次刷新之间（闲档间隔见 workers/collector 的 apple-recent IDLE_EVERY_MINUTES）；
// 一首歌比刷新间隔长时，中间会有几轮列表不变。相邻两段之间不超过这个间隔就视为一直在放，后一段往前接到前一段末尾。
export const LISTENING_TRACE_BRIDGE_MS = 6 * 60 * 1000;

// Apple 播放历史可能延迟同步；保留匹配余量，避免把刚结束的播放误画成别处播放。
export const LISTENING_TRACE_MATCH_SLACK_MS = 5 * 60 * 1000;

export function playbackSignature(tracks: RecentTrack[]): string {
  return tracks.map((track) => track.id).join("\n");
}

export function listeningTrace(
  previous: { tracks: RecentTrack[]; fetchedAt: number } | null,
  next: { tracks: RecentTrack[]; fetchedAt: number },
): ListeningTrace | null {
  if (!previous || next.fetchedAt <= previous.fetchedAt) return null;
  if (playbackSignature(previous.tracks) === playbackSignature(next.tracks)) return null;
  const known = new Set(previous.tracks.map((track) => track.id));
  const named = next.tracks.find((track) => !known.has(track.id)) ?? next.tracks[0] ?? null;
  return {
    since: previous.fetchedAt,
    t: next.fetchedAt,
    title: pulseText(named?.title),
    artist: pulseText(named?.artist),
    album: pulseText(named?.album),
    itemId: pulseText(named?.id, 80),
  };
}

export function parseListeningTrace(raw: string): ListeningTrace | null {
  try {
    const row = JSON.parse(raw) as Record<string, unknown> | null;
    if (!row || typeof row !== "object") return null;
    const { t, since } = row;
    if (typeof t !== "number" || !Number.isSafeInteger(t) || typeof since !== "number" || !Number.isSafeInteger(since) || since >= t) return null;
    return { since, t, title: pulseText(row.title), artist: pulseText(row.artist), album: pulseText(row.album), itemId: pulseText(row.itemId, 80) };
  } catch {
    return null;
  }
}
