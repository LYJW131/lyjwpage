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

// Apple「最近播放的歌」去重、最新在前，一首歌开播就排到最前（滞后 LISTENING_TRACE_LAG_MS），但不给时刻：
// 开播只能定位在两次刷新之间 (since, t]。同一窗口里新播了几首就有几行，按播放先后排；durationMs 是这首的时长。
export type ListeningTrace = {
  since: number;
  t: number;
  title: string | null;
  artist: string | null;
  album: string | null;
  itemId: string | null;
  durationMs: number | null;
};
export const LISTENING_TRACE_CAP = 2000;

// 从开播到出现在列表最前的滞后。
export const LISTENING_TRACE_LAG_MS = 0;

// 判定「接着上一首放」的余量：列表更新的抖动加换曲间隙。差得更多就是切歌或停过，另起一串。
export const LISTENING_RUN_SLACK_MS = 5_000;

// 没有时长的行（durationMs 为 null）：下一首在这个间隔内开播就视为一直放到那时，否则只画到自己的窗口末尾。
export const LISTENING_TRACE_BRIDGE_MS = 6 * 60 * 1000;

// Mac / HomePod 的段起点是收到上报的时刻，可能晚于真实开播；同名歌按这个余量算被它们解释，宁可少画也不重复画。
export const LISTENING_TRACE_MATCH_SLACK_MS = 5 * 60 * 1000;

export type RecentTracksSnapshot = { tracks: RecentTrack[]; fetchedAt: number };

// 两次刷新之间新播的歌是新列表的前缀：去掉它们之后，剩下的必须与旧列表去掉同样几首后的顺序一致
// （列表只取前 N 首，底部掉出或补进的歌不算变化）。返回按播放先后排的新播歌；
// 旧列表反过来能由新列表这样解释，说明这次拿到的是更旧的副本，返回 "stale"；两边都解释不了返回 null。
export function playedBetween(previous: RecentTrack[], next: RecentTrack[]): RecentTrack[] | "stale" | null {
  const played = newlyPlayed(previous, next);
  if (played) return played.reverse();
  return newlyPlayed(next, previous)?.length ? "stale" : null;
}

function newlyPlayed(previous: RecentTrack[], next: RecentTrack[]): RecentTrack[] | null {
  for (let count = 0; count <= next.length; count += 1) {
    const replayed = new Set(next.slice(0, count).map((track) => track.id));
    const rest = previous.filter((track) => !replayed.has(track.id));
    const overlap = Math.min(rest.length, next.length - count);
    if (overlap === 0 && rest.length > 0) return null;
    let consistent = true;
    for (let index = 0; index < overlap; index += 1) {
      if (next[count + index].id !== rest[index].id) { consistent = false; break; }
    }
    if (consistent) return next.slice(0, count);
  }
  return null;
}

export function listeningTraces(previous: RecentTracksSnapshot | null, next: RecentTracksSnapshot): { traces: ListeningTrace[]; keep: boolean } {
  if (!previous) return { traces: [], keep: true };
  if (next.fetchedAt <= previous.fetchedAt) return { traces: [], keep: false };
  const played = playedBetween(previous.tracks, next.tracks);
  if (played === "stale") return { traces: [], keep: false };
  return {
    traces: (played ?? []).map((track) => ({
      since: previous.fetchedAt,
      t: next.fetchedAt,
      title: pulseText(track.title),
      artist: pulseText(track.artist),
      album: pulseText(track.album),
      itemId: pulseText(track.id, 80),
      durationMs: positiveMs(track.durationMs),
    })),
    keep: true,
  };
}

function positiveMs(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function parseListeningTrace(raw: string): ListeningTrace | null {
  try {
    const row = JSON.parse(raw) as Record<string, unknown> | null;
    if (!row || typeof row !== "object") return null;
    const { t, since } = row;
    if (typeof t !== "number" || !Number.isSafeInteger(t) || typeof since !== "number" || !Number.isSafeInteger(since) || since >= t) return null;
    return {
      since,
      t,
      title: pulseText(row.title),
      artist: pulseText(row.artist),
      album: pulseText(row.album),
      itemId: pulseText(row.itemId, 80),
      durationMs: positiveMs(row.durationMs),
    };
  } catch {
    return null;
  }
}

export type InferredPlay = {
  from: number;
  to: number;
  marginMs: number;
  title: string | null;
  artist: string | null;
  itemId: string | null;
};

// 连续播放时每首的开播 = 这一串第一首的开播 + 前面各首时长之和，每条痕迹的窗口都约束同一个起点；
// 各窗口求交，交集为空就是切歌或停过，另起一串。起点取交集中点，误差半宽记在 marginMs（不含 LISTENING_TRACE_LAG_MS 本身的误差）。
// 一首放到时长用完或下一首开播为止，不知道中途暂停或停播。
export function inferredPlays(traces: ListeningTrace[]): InferredPlay[] {
  type Run = { lo: number; hi: number; members: { trace: ListeningTrace; offset: number }[] };
  const runs: Run[] = [];
  for (const trace of traces) {
    const lo = trace.since - LISTENING_TRACE_LAG_MS - LISTENING_RUN_SLACK_MS;
    const hi = trace.t - LISTENING_TRACE_LAG_MS + LISTENING_RUN_SLACK_MS;
    const run = runs.at(-1);
    const last = run?.members.at(-1);
    if (run && last?.trace.durationMs) {
      const offset = last.offset + last.trace.durationMs;
      const from = Math.max(run.lo, lo - offset), to = Math.min(run.hi, hi - offset);
      if (from <= to) {
        run.lo = from;
        run.hi = to;
        run.members.push({ trace, offset });
        continue;
      }
    }
    runs.push({ lo, hi, members: [{ trace, offset: 0 }] });
  }
  const starts = runs.flatMap((run) => run.members.map(({ trace, offset }) => ({
    trace,
    start: Math.round((run.lo + run.hi) / 2) + offset,
    marginMs: Math.round((run.hi - run.lo) / 2),
  })));
  return starts.map(({ trace, start, marginMs }, index) => {
    const next = starts[index + 1]?.start ?? Infinity;
    const natural = trace.durationMs ? start + trace.durationMs : next - start <= LISTENING_TRACE_BRIDGE_MS ? next : trace.t;
    return {
      from: start,
      to: Math.max(start, Math.min(natural, next)),
      marginMs,
      title: trace.title,
      artist: trace.artist,
      itemId: trace.itemId,
    };
  });
}
