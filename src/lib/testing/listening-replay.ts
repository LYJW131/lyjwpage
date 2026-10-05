import fs from "node:fs";

import type { PlayingContainer } from "@/lib/types";
import { inferredPlays, LISTENING_TRACE_LAG_MS, listeningTraces, predictedNext, type InferredPlay, type ListeningTrace, type RecentTracksSnapshot } from "@shared/pulse-listening";

// 一段录下来的 iPhone 播放：每 pollEveryMs 拉一次「最近播放的歌」，lists 是出现过的列表（条目 id 换成了 tNN），
// polls 是 [相对 startedAt 的毫秒, lists 下标]；collector 是同一时段生产采集 Worker 记下的 [since, t, 条目]。
export type RecordedSession = {
  startedAt: number;
  pollEveryMs: number;
  tracks: Record<string, { title: string; artist: string; durationMs: number }>;
  lists: string[][];
  polls: [number, number][];
  collector: [number, number, string][];
};

export type ReplaySpan = { from: number; to: number; title: string | null };

// 基准只认两轮间隔不超过这个值的上榜：停过拉取的那一大段只知道「中间放过」，不拿来给别的口径打分。
const TRUTH_WINDOW_MAX_MS = 10_000;

export function loadRecordedSession(): RecordedSession {
  return JSON.parse(fs.readFileSync(new URL("./recent-tracks-session.json", import.meta.url), "utf8")) as RecordedSession;
}

function snapshot(session: RecordedSession, [at, list]: [number, number]): RecentTracksSnapshot {
  return {
    fetchedAt: session.startedAt + at,
    tracks: session.lists[list].map((id) => ({ id, album: null, ...session.tracks[id] })),
  };
}

// 列表最前那首换了就是新开播：上榜取两轮的中点，开播再早 LISTENING_TRACE_LAG_MS；放到下一首开播或时长用完。
export function recordedTruth(session: RecordedSession): (ReplaySpan & { scored: boolean })[] {
  const starts: { at: number; id: string; scored: boolean }[] = [];
  for (let index = 1; index < session.polls.length; index += 1) {
    const [before, previous] = session.polls[index - 1], [at, list] = session.polls[index];
    const top = session.lists[list][0];
    if (top === session.lists[previous][0]) continue;
    starts.push({ at: session.startedAt + Math.round((before + at) / 2) - LISTENING_TRACE_LAG_MS, id: top, scored: at - before <= TRUTH_WINDOW_MAX_MS });
  }
  return starts.map((start, index) => {
    const next = starts[index + 1]?.at ?? Infinity;
    return { from: start.at, to: Math.min(start.at + session.tracks[start.id].durationMs, next), title: session.tracks[start.id].title, scored: start.scored };
  });
}

export function replayedPlays(session: RecordedSession, everyPolls: number, phase: number): InferredPlay[] {
  const traces: ListeningTrace[] = [];
  let base: RecentTracksSnapshot | null = null;
  for (const [index, poll] of session.polls.entries()) {
    if (index % everyPolls !== phase) continue;
    const next = snapshot(session, poll);
    const { traces: found, keep } = listeningTraces(base, next);
    traces.push(...found);
    if (keep) base = next;
  }
  return inferredPlays(traces);
}

export function collectorPlays(session: RecordedSession): InferredPlay[] {
  return inferredPlays(session.collector.map(([since, t, id]) => ({
    since: session.startedAt + since,
    t: session.startedAt + t,
    title: session.tracks[id].title,
    artist: session.tracks[id].artist,
    album: null,
    itemId: id,
    durationMs: session.tracks[id].durationMs,
    songId: null,
    artworkUrl: null,
  })));
}

function union(spans: ReplaySpan[]): { from: number; to: number }[] {
  const merged: { from: number; to: number }[] = [];
  for (const span of [...spans].sort((a, b) => a.from - b.from)) {
    const last = merged.at(-1);
    if (last && span.from <= last.to) last.to = Math.max(last.to, span.to);
    else merged.push({ from: span.from, to: span.to });
  }
  return merged;
}

// 只在基准可计分、开播落在 (range.from, range.to] 的播放里比：标对歌名的时间占比，
// 以及每首开播的误差（取同名、开播最近的那一段）。
export function scoreReplay(truth: (ReplaySpan & { scored: boolean })[], plays: ReplaySpan[], range: { from: number; to: number }) {
  const scored = truth.filter((play) => play.scored && play.from > range.from && play.from <= range.to);
  let total = 0, correct = 0;
  for (const play of scored) {
    const to = Math.min(play.to, range.to);
    total += to - play.from;
    for (const drawn of union(plays.filter((span) => span.title === play.title))) {
      correct += Math.max(0, Math.min(to, drawn.to) - Math.max(play.from, drawn.from));
    }
  }
  const startErrorsMs = scored.flatMap((play) => {
    const nearest = plays.filter((drawn) => drawn.title === play.title)
      .sort((a, b) => Math.abs(a.from - play.from) - Math.abs(b.from - play.from))[0];
    return nearest ? [nearest.from - play.from] : [];
  });
  return { coverage: total ? correct / total : 0, startErrorsMs, plays: scored.length, matched: startErrorsMs.length };
}

export function replayAtCadence(session: RecordedSession, truth: (ReplaySpan & { scored: boolean })[], cadenceMs: number) {
  const every = Math.round(cadenceMs / session.pollEveryMs);
  const coverage: number[] = [];
  const startErrorsMs: number[] = [];
  let missed = 0;
  for (let phase = 0; phase < every; phase += 1) {
    const sampled = session.polls.filter((_, index) => index % every === phase);
    const range = { from: session.startedAt + sampled[0][0], to: session.startedAt + sampled.at(-1)![0] };
    const result = scoreReplay(truth, replayedPlays(session, every, phase), range);
    coverage.push(result.coverage);
    startErrorsMs.push(...result.startErrorsMs);
    missed += result.plays - result.matched;
  }
  return { coverage, startErrorsMs, missed };
}

export function absoluteQuantile(values: number[], q: number): number {
  const sorted = values.map(Math.abs).sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? NaN;
}

// 录的是一个歌单从头顺序放、没有手动切歌，容器就按每轮都拉时推出的开播顺序排（停拉那段放过的歌也在里面）。
export function recordedContainer(session: RecordedSession): PlayingContainer {
  const order = [...new Set(replayedPlays(session, 1, 0).map((play) => play.itemId))];
  return {
    id: "recorded",
    tracks: order.flatMap((id) => id ? [{ id, songId: null, title: session.tracks[id].title, artist: session.tracks[id].artist, durationMs: session.tracks[id].durationMs, artworkUrl: null }] : []),
  };
}

// 每轮拉到新歌时，拿推出的最后一首去问下一首，再和每轮都拉时推出的顺序里它之后的那首比（基准漏掉了停拉那段的歌）；
// 每首只在它第一次被看见的那轮算一次。
export function replayNextAtCadence(session: RecordedSession, container: PlayingContainer | null, cadenceMs: number) {
  const every = Math.round(cadenceMs / session.pollEveryMs);
  const truth = replayedPlays(session, 1, 0);
  let right = 0, wrong = 0, silent = 0, thenWrong = 0;
  for (let phase = 0; phase < every; phase += 1) {
    const traces: ListeningTrace[] = [];
    let base: RecentTracksSnapshot | null = null;
    for (const [index, poll] of session.polls.entries()) {
      if (index % every !== phase) continue;
      const next = snapshot(session, poll);
      const { traces: found, keep } = listeningTraces(base, next);
      if (keep) base = next;
      if (!found.length) continue;
      traces.push(...found);
      const plays = inferredPlays(traces);
      const current = plays.at(-1)!;
      const at = truth
        .map((play, order) => ({ play, order }))
        .filter(({ play }) => play.title === current.title)
        .sort((a, b) => Math.abs(a.play.from - current.from) - Math.abs(b.play.from - current.from))[0];
      const expected = at ? truth[at.order + 1]?.title : undefined;
      if (!expected) continue;
      const guess = predictedNext(plays, container);
      if (!guess) silent += 1;
      else if (guess.title === expected) right += 1;
      else wrong += 1;
      const after = truth[at.order + 2]?.title;
      if (guess?.then && after && guess.then.title !== after) thenWrong += 1;
    }
  }
  return { right, wrong, silent, thenWrong };
}
