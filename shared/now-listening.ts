import { homePodVisibleAt } from "@shared/homepod-store";
import { offlineByLiveness, withPresence, type Liveness } from "@shared/reporter-liveness";
import type { LocalNowPlaying, NowListeningAlternate, NowListeningPayload, PlayingContainer, TrackMotion } from "@shared/types";
import { playingElsewhere, sameSong, type ListeningTrace } from "@shared/pulse-listening";

export const MUSIC_PAUSE_GRACE_MS = 10_000;

export type NowListeningSnapshot = {
  mac: NowListeningCandidate | null;
  homePod: NowListeningCandidate | null;
  player?: NowListeningCandidate | null;
  macReceivedAt: number;
  traces?: ListeningTrace[];
  container?: PlayingContainer | null;
};

export type NowListeningCandidate = {
  music: LocalNowPlaying;
  receivedAt: number;
  id: string | null;
  link: string | null;
  songId: string | null;
  upcomingSongIds: string[];
  hasLyrics: boolean;
  motion: TrackMotion | null;
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
    motion: candidate.motion,
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
  const player =
    snapshot.player && homePodVisibleAt(snapshot.player, now) ? snapshot.player : null;
  // Mac 的 Music.app 优先，其次是自己报事件的播放器，最后是 HomePod；在放或刚暂停的都算，前一格刚暂停也压过后一格在放。
  const candidates = [mac, player, homePod];

  const chosen = candidates.find((candidate) =>
    candidate && (candidate.music.state === "playing" || isPausedFresh(candidate.music, now))) ?? null;
  const other = chosen
    ? candidates.find((candidate) => candidate && candidate !== chosen && candidate.music.state === "playing")
    : null;
  const alternate = other ? alternateOf(other) : null;
  const inferred = playingElsewhere(snapshot.traces ?? [], now, snapshot.container ?? null);
  // 播放器报的艺人是逗号连起来的，Apple 列表里多位艺人另有写法；补全查到的目录 id 对上也算同一首。
  const reported = !!inferred && candidates.some((candidate) =>
    candidate?.music.state === "playing"
      && ((!!candidate.songId && candidate.songId === inferred.songId) || sameSong(candidate.music, inferred)));

  return withPresence({
    music: chosen?.music ?? null,
    receivedAt:
      Math.max(
        snapshot.macReceivedAt || live.lastSeenAt || 0,
        snapshot.homePod?.receivedAt ?? 0,
        snapshot.player?.receivedAt ?? 0,
      ) || null,
    idle: !chosen,
    id: chosen?.id ?? null,
    link: chosen?.link ?? null,
    songId: chosen?.songId ?? null,
    upcomingSongIds: chosen?.upcomingSongIds ?? [],
    hasLyrics: chosen?.hasLyrics ?? false,
    motion: chosen?.motion ?? null,
    expiresInMs:
      chosen?.music.state === "paused"
        ? Math.max(0, MUSIC_PAUSE_GRACE_MS - (now - chosen.music.observedAt))
        : null,
    alternate,
    elsewhere: reported ? null : inferred,
  }, live);
}
