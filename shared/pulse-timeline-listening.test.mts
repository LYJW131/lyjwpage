import assert from "node:assert/strict";
import test from "node:test";

import {
  LISTENING_TRACE_JITTER_MS,
  LISTENING_TRACE_LAG_MS,
  inferredPlays,
  listeningObservation,
  listeningTraces,
  nextTraceBy,
  parseListeningTrace,
  playedBetween,
  playingElsewhere,
  type ListeningTrace,
} from "@shared/pulse-listening";
import {
  PULSE_STATE_HOLD_MS,
} from "@shared/pulse-timeline";
import type { LocalNowPlaying, RecentTrack } from "@shared/types";

const T = 1_800_000_000_000;
const M = 60_000;

const macMusic = (state: LocalNowPlaying["state"], title = "Helpless"): LocalNowPlaying => ({
  source: "apple-music", state, title, artist: "Hamilton", album: "Hamilton", trackId: "t1", artworkUrl: null,
  positionMs: 0, durationMs: 180_000, repeatOne: false, observedAt: T,
});
const online = { lastSeenAt: T, declaredOffline: false };

test("listening observation: Mac playing wins, then HomePod playing, then paused; paused has no grace period", () => {
  const homePod = { music: { ...macMusic("playing", "Satisfied"), source: "homepod" as const }, receivedAt: T };
  assert.equal(listeningObservation({ mac: macMusic("playing"), macObserved: true, homePod }, online, T)?.facts.title, "Helpless");
  assert.deepEqual(listeningObservation({ mac: macMusic("paused"), macObserved: true, homePod }, online, T)?.facts,
    { state: "playing", source: "homepod", title: "Satisfied", artist: "Hamilton", album: "Hamilton", trackId: "t1" });
  assert.equal(listeningObservation({ mac: macMusic("paused"), macObserved: true, homePod: null }, { ...online, lastSeenAt: T + 10 * M }, T + 10 * M)?.facts.state, "paused");
  assert.equal(listeningObservation({ mac: macMusic("stopped"), macObserved: true, homePod: null }, online, T)?.facts.state, "idle");
});

test("listening observation: Mac facts hold ten minutes; HomePod facts stay open while visible and end at the track end", () => {
  assert.deepEqual(listeningObservation({ mac: macMusic("playing"), macObserved: true, homePod: null }, online, T)?.hold, { until: T + PULSE_STATE_HOLD_MS });
  const offline = { lastSeenAt: T, declaredOffline: true };
  const long = { music: { ...macMusic("playing", "Twenty minutes"), source: "homepod" as const, durationMs: 20 * M }, receivedAt: T };
  assert.deepEqual(listeningObservation({ mac: null, macObserved: true, homePod: long }, offline, T)?.hold, { until: T + 25 * M, endsBy: T + 20 * M },
    "remaining time plus grace to stay open; the track end is what gets stored");
  const loop = { music: { ...long.music, repeatOne: true }, receivedAt: T };
  assert.deepEqual(listeningObservation({ mac: null, macObserved: true, homePod: loop }, offline, T)?.hold, { until: T + 30 * M, endsBy: null }, "repeat-one window");
  const paused = { music: { ...long.music, state: "paused" as const, positionMs: 5 * M }, receivedAt: T };
  assert.equal(listeningObservation({ mac: null, macObserved: true, homePod: paused }, offline, T + 12 * M)?.facts.state, "paused");
  assert.deepEqual(listeningObservation({ mac: null, macObserved: true, homePod: paused }, offline, T + 12 * M)?.hold, { until: T + 20 * M, endsBy: T + 15 * M });
});

test("listening observation: an offline Mac without a live HomePod is unknown, not idle", () => {
  const offline = { lastSeenAt: T, declaredOffline: true };
  assert.equal(listeningObservation({ mac: macMusic("playing"), macObserved: true, homePod: null }, offline, T), null);
  assert.equal(listeningObservation({ mac: null, macObserved: false, homePod: null }, online, T), null, "appleMusic module off");
  const homePod = { music: { ...macMusic("playing", "Satisfied"), source: "homepod" as const }, receivedAt: T };
  assert.equal(listeningObservation({ mac: null, macObserved: false, homePod }, offline, T)?.facts.source, "homepod");
});

const track = (id: string, title = id, durationMs: number | null = null): RecentTrack => ({ id, title, artist: "YOASOBI", album: "THE BOOK 3", durationMs });
const ids = (tracks: RecentTrack[] | "stale" | null) => Array.isArray(tracks) ? tracks.map((row) => row.id) : tracks;
const list = (...names: string[]) => names.map((name) => track(name));

test("recently played: the newly played songs are the front of the new list, oldest first; older copies and unexplained lists are not plays", () => {
  assert.deepEqual(ids(playedBetween(list("a", "b", "c"), list("a", "b", "c"))), []);
  assert.deepEqual(ids(playedBetween(list("a", "b", "c"), list("x", "a", "b"))), ["x"], "the bottom falls off a capped list");
  assert.deepEqual(ids(playedBetween(list("a", "b", "c"), list("y", "x", "a"))), ["x", "y"], "two songs in one refresh, in the order they played");
  assert.deepEqual(ids(playedBetween(list("a", "b", "c"), list("c", "a", "b"))), ["c"], "a replayed song moves to the front");
  assert.deepEqual(ids(playedBetween(list("a", "b", "c"), list("b", "a", "c"))), ["b"]);
  assert.deepEqual(ids(playedBetween(list("a", "b", "c"), list("c", "a", "b", "d"))), ["c"], "older songs a longer list brings in at the bottom are not plays");
  assert.equal(playedBetween(list("b", "a", "c", "d"), list("a", "c", "d", "e")), "stale", "an edge copy from before b was played");
  assert.equal(playedBetween(list("a", "b", "c"), list("a", "b", "d")), null, "only the bottom changed");
  assert.equal(playedBetween(list("a", "b"), list("x", "y")), null, "nothing in common");
});

test("recently played traces: need a baseline, keep a stale copy out of the baseline, carry each song's length", () => {
  assert.deepEqual(listeningTraces(null, { tracks: list("a"), fetchedAt: T }), { traces: [], keep: true });
  assert.deepEqual(listeningTraces({ tracks: list("a"), fetchedAt: T }, { tracks: [{ ...track("a"), album: "renamed" }], fetchedAt: T + M }), { traces: [], keep: true });
  assert.deepEqual(listeningTraces({ tracks: list("a"), fetchedAt: T }, { tracks: [track("c", "Idol", 213_000), track("b", "Yoru ni Kakeru", 261_000), track("a")], fetchedAt: T + 2 * M }), {
    traces: [
      { since: T, t: T + 2 * M, title: "Yoru ni Kakeru", artist: "YOASOBI", album: "THE BOOK 3", itemId: "b", durationMs: 261_000, songId: null, artworkUrl: null },
      { since: T, t: T + 2 * M, title: "Idol", artist: "YOASOBI", album: "THE BOOK 3", itemId: "c", durationMs: 213_000, songId: null, artworkUrl: null },
    ],
    keep: true,
  });
  assert.deepEqual(listeningTraces({ tracks: list("b", "a"), fetchedAt: T }, { tracks: list("a"), fetchedAt: T + M }), { traces: [], keep: false });
  assert.deepEqual(listeningTraces({ tracks: list("a"), fetchedAt: T }, { tracks: list("b", "a"), fetchedAt: T }), { traces: [], keep: false });
  assert.equal(parseListeningTrace(JSON.stringify({ since: T, t: T })), null);
  assert.equal(parseListeningTrace("{"), null);
  assert.equal(parseListeningTrace(JSON.stringify({ since: T, t: T + M, title: "Idol" }))?.durationMs, null, "a row without a length");
});

test("inferred plays: a continuous run pins every start with all of its windows; a cut-short song or a pause starts a new run", () => {
  const S = 1000;
  const trace = (since: number, t: number, title: string, duration: number | null): ListeningTrace =>
    ({ since: T + since * S, t: T + t * S, title, artist: "YOASOBI", album: null, itemId: title, durationMs: duration && duration * S, songId: null, artworkUrl: null });
  const plays = inferredPlays([
    trace(0, 60, "A", 200),
    trace(180, 240, "B", 100),
    trace(300, 360, "C", 300),
    trace(360, 420, "D", 250),
    trace(2000, 2060, "E", null),
  ]);
  const lag = LISTENING_TRACE_LAG_MS / S;
  assert.deepEqual(plays.map((play) => [play.title, (play.from - T) / S, (play.to - T) / S]), [
    ["A", 20 - lag, 220 - lag],
    ["B", 220 - lag, 320 - lag],
    ["C", 320 - lag, 390 - lag],
    ["D", 390 - lag, 640 - lag],
    ["E", 2030 - lag, 2060],
  ], "A–C back to back: their windows put A's start in (0, 40]; D opened while C had time left, so C was cut short; E has no length");
  assert.equal(plays[0].marginMs, 20 * S, "three windows narrow the start to half of one window");
  assert.equal(plays[3].marginMs, 30 * S);
});

test("inferred plays: the start margin is the ideal one, without the slack; windows a jitter pushes apart give half the gap", () => {
  const S = 1000;
  const trace = (since: number, t: number, title: string, duration: number): ListeningTrace =>
    ({ since: T + since * S, t: T + t * S, title, artist: "YOASOBI", album: null, itemId: title, durationMs: duration * S, songId: null, artworkUrl: null });
  const narrowed = inferredPlays([trace(0, 15, "A", 200), trace(205, 220, "B", 100)]);
  assert.deepEqual(narrowed.map((play) => play.marginMs), [5 * S, 5 * S], "B's window leaves (5, 15] of A's (0, 15]");
  const jittered = inferredPlays([trace(0, 15, "A", 200), trace(217, 232, "B", 100)]);
  assert.deepEqual(jittered.map((play) => play.marginMs), [1 * S, 1 * S], "two seconds apart is within the slack: one run, off by half the gap");
});

test("next trace: the next song of a continuous run should top the list by the end of this one plus the lag, its margin and the jitter", () => {
  const S = 1000;
  const traces: ListeningTrace[] = [
    { since: T, t: T + 15 * S, title: "A", artist: "YOASOBI", album: null, itemId: "A", durationMs: 200 * S, songId: null, artworkUrl: null },
  ];
  const [play] = inferredPlays(traces);
  const by = play.from + 200 * S + LISTENING_TRACE_LAG_MS + play.marginMs + LISTENING_TRACE_JITTER_MS;
  assert.equal(nextTraceBy(traces, T + 60 * S), by);
  assert.equal(nextTraceBy(traces, by), null, "past it the run has stopped or paused");
  assert.equal(nextTraceBy([{ ...traces[0], durationMs: null }], T + 60 * S), null, "no length, no expectation");
  assert.equal(nextTraceBy([], T), null);
});

test("inferred plays: a song cut short inside the same refresh as the next one stays on the timeline, before it", () => {
  const S = 1000;
  const trace = (title: string, duration: number): ListeningTrace =>
    ({ since: T, t: T + 60 * S, title, artist: "YOASOBI", album: null, itemId: title, durationMs: duration * S, songId: null, artworkUrl: null });
  const [skipped, next] = inferredPlays([trace("A", 240), trace("B", 200)]);
  assert.ok(skipped.to > skipped.from, "the skipped song keeps a span");
  assert.equal(skipped.to, next.from);
  assert.ok(next.from > skipped.from && next.from <= T + 60 * S - LISTENING_TRACE_LAG_MS);
});

test("inferred plays: songs skipped through in one refresh all start, in order, before the list showed them", () => {
  const S = 1000;
  const seen = T + 60 * S;
  const traces = ["A", "B", "C", "D", "E", "F"].map((title): ListeningTrace =>
    ({ since: T, t: seen, title, artist: "YOASOBI", album: null, itemId: title, durationMs: 240 * S, songId: null, artworkUrl: null }));
  const plays = inferredPlays(traces);
  for (const [index, play] of plays.entries()) {
    assert.ok(play.from <= seen - LISTENING_TRACE_LAG_MS, `${play.title} starts by the time the list showed it`);
    if (index) assert.ok(play.from > plays[index - 1].from, `${play.title} starts after the song before it`);
  }
  assert.equal(playingElsewhere(traces, seen)?.title, "F", "the list's newest song is playing when it is seen");
});

test("inferred plays: short songs after a skip-through keep a non-negative start margin", () => {
  const S = 1000;
  const trace = (title: string, since: number, t: number, duration: number): ListeningTrace =>
    ({ since: T + since * S, t: T + t * S, title, artist: "YOASOBI", album: null, itemId: title, durationMs: duration * S, songId: null, artworkUrl: null });
  const plays = inferredPlays([trace("A", 0, 60, 240), trace("B", 0, 60, 10), trace("C", 60, 90, 10), trace("D", 90, 100, 10)]);
  for (const play of plays) {
    assert.ok(play.marginMs >= 0, `${play.title} has margin ${play.marginMs}`);
    assert.ok(play.to >= play.from);
  }
});
