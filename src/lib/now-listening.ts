import { homePodVisibleAt } from "@/lib/homepod-store";
import { offlineByLiveness, withPresence, type Liveness } from "@/lib/reporter-liveness";
import type { LocalNowPlaying, NowListeningAlternate, NowListeningPayload } from "@/lib/types";

export const MUSIC_PAUSE_GRACE_MS = 10_000;

export type NowListeningSnapshot = {
  mac: NowListeningCandidate | null;
  homePod: NowListeningCandidate | null;
  macReceivedAt: number;
};

export type NowListeningCandidate = {
  music: LocalNowPlaying;
  receivedAt: number;
  id: string | null;
  link: string | null;
  songId: string | null;
  upcomingSongIds: string[];
  hasLyrics: boolean;
};

function isPausedFresh(music: LocalNowPlaying, now: number) {
  return music.state === "paused" && now - music.observedAt < MUSIC_PAUSE_GRACE_MS;
}

function alternateOf(candidate: NowListeningCandidate): NowListeningAlternate {
  return {
    music: candidate.music,
    id: candidate.id,
    link: candidate.link,
    songId: candidate.songId,
    upcomingSongIds: candidate.upcomingSongIds,
    hasLyrics: candidate.hasLyrics,
  };
}

// 存活和暂停宽限是时间函数，不能冻结在候选快照缓存中。
export function pickNowListening(
  snapshot: NowListeningSnapshot,
  live: Liveness,
  now = Date.now(),
): NowListeningPayload {
  const mac = offlineByLiveness(live, now) ? null : snapshot.mac;
  const homePod =
    snapshot.homePod && homePodVisibleAt(snapshot.homePod, now) ? snapshot.homePod : null;

  const chosen =
    (mac?.music.state === "playing" ? mac : null) ??
    (mac && isPausedFresh(mac.music, now) ? mac : null) ??
    (homePod?.music.state === "playing" ? homePod : null) ??
    (homePod && isPausedFresh(homePod.music, now) ? homePod : null);
  const alternate =
    chosen && chosen === mac && homePod?.music.state === "playing" ? alternateOf(homePod) : null;

  return withPresence({
    music: chosen?.music ?? null,
    receivedAt:
      Math.max(
        snapshot.macReceivedAt || live.lastSeenAt || 0,
        snapshot.homePod?.receivedAt ?? 0,
      ) || null,
    idle: !chosen,
    id: chosen?.id ?? null,
    link: chosen?.link ?? null,
    songId: chosen?.songId ?? null,
    upcomingSongIds: chosen?.upcomingSongIds ?? [],
    hasLyrics: chosen?.hasLyrics ?? false,
    expiresInMs:
      chosen?.music.state === "paused"
        ? Math.max(0, MUSIC_PAUSE_GRACE_MS - (now - chosen.music.observedAt))
        : null,
    alternate,
  }, live);
}
