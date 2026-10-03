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
  GAMING_HOLD_MS,
  PULSE_STATE_HOLD_MS,
  chargingSegments,
  chargingSessions,
  chargingSummary,
  currentChargingPower,
  gamingFacts,
  parseClosedInterval,
  parseOpenInterval,
  planChargingSample,
  planStateObservation,
  replaceActivityBuckets,
  LISTENING_PAUSE_MAX_MS,
  stateSegments,
  watchingFacts,
  type ListeningFacts,
} from "@shared/pulse-timeline";
import type { LocalNowPlaying, RecentTrack } from "@/lib/types";

const T = 1_800_000_000_000;
const M = 60_000;

const playing: ListeningFacts = { state: "playing", source: "mac", title: "Helpless", artist: "Hamilton", album: "Hamilton", trackId: "1" };

test("state observation: first sighting opens, same facts only bump seenAt once a minute, a change closes at that moment", () => {
  const first = planStateObservation("listening", null, T, playing);
  assert.deepEqual(first, { closed: [], open: { ...playing, from: T, seenAt: T, holdUntil: T + PULSE_STATE_HOLD_MS, endsBy: null } });
  const open = first!.open!;
  assert.equal(planStateObservation("listening", open, T + 30_000, playing), null, "under a minute is not written");
  assert.equal(planStateObservation("listening", open, T, playing), null, "replays are dropped");
  assert.deepEqual(planStateObservation("listening", open, T + M, playing), { closed: [], open: { ...open, seenAt: T + M, holdUntil: T + M + PULSE_STATE_HOLD_MS } });
  const next = { ...playing, title: "Satisfied" };
  assert.deepEqual(planStateObservation("listening", open, T + 3 * M, next), {
    closed: [{ ...playing, from: T, to: T + 3 * M }],
    open: { ...next, from: T + 3 * M, seenAt: T + 3 * M, holdUntil: T + 3 * M + PULSE_STATE_HOLD_MS, endsBy: null },
  });
});

test("state observation: a dead periodic source ends at its last confirmation; unobservable closes and leaves unknown", () => {
  const open = { ...playing, from: T, seenAt: T + 4 * M, holdUntil: T + 4 * M + PULSE_STATE_HOLD_MS, endsBy: null };
  const late = T + 4 * M + PULSE_STATE_HOLD_MS + 1;
  assert.deepEqual(planStateObservation("listening", open, late, playing), {
    closed: [{ ...playing, from: T, to: T + 4 * M }],
    open: { ...playing, from: late, seenAt: late, holdUntil: late + PULSE_STATE_HOLD_MS, endsBy: null },
  }, "the grace is not counted as listening");
  assert.deepEqual(planStateObservation("listening", open, late, null), { closed: [{ ...playing, from: T, to: T + 4 * M }], open: null });
  assert.deepEqual(planStateObservation("listening", open, T + 5 * M, null), { closed: [{ ...playing, from: T, to: T + 5 * M }], open: null },
    "an explicit offline inside the hold closes at that moment");
});

test("state observation: a HomePod track with no further push ends when it should have finished, not after the grace", () => {
  const homePod = { ...playing, source: "homepod" as const };
  const first = planStateObservation("listening", null, T, homePod, { until: T + 25 * M, endsBy: T + 20 * M })!.open!;
  assert.deepEqual([first.holdUntil, first.endsBy], [T + 25 * M, T + 20 * M]);
  assert.deepEqual(stateSegments("listening", [], first, { from: T - M, to: T + 15 * M }).map((row) => [row.from - T, row.to - T]), [[0, 15 * M]],
    "still drawn live after the flat 10-minute hold");
  assert.deepEqual(stateSegments("listening", [], first, { from: T - M, to: T + 30 * M }).map((row) => [row.from - T, row.to - T]), [[0, 20 * M]],
    "past the grace it is drawn to the track end, as it will be stored");
  assert.deepEqual(planStateObservation("listening", first, T + 20 * M, { ...homePod, title: "Next" }, { until: T + 45 * M, endsBy: T + 40 * M })!.closed,
    [{ ...homePod, from: T, to: T + 20 * M }], "the next push closes the whole track");
  assert.deepEqual(planStateObservation("listening", first, T + 40 * M, { ...homePod, title: "Later" }, { until: T + 65 * M, endsBy: T + 60 * M })!.closed,
    [{ ...homePod, from: T, to: T + 20 * M }], "a push long after the grace still keeps the track up to its end");
  const loop = planStateObservation("listening", null, T, homePod, { until: T + 30 * M, endsBy: null })!.open!;
  assert.deepEqual(planStateObservation("listening", loop, T + 40 * M, null)!.closed, [], "repeat-one has no known end beyond its only sighting");
  assert.equal(planStateObservation("listening", first, T + 30_000, homePod, { until: T + 27 * M, endsBy: T + 22 * M })?.open?.endsBy, T + 22 * M,
    "a new HomePod snapshot moving the end is written before the minute is up");
});

test("state observation: explicit Emby stop stays idle until the next play; PSN has a longer hold", () => {
  const idle = watchingFacts(null, null);
  const open = planStateObservation("watching", null, T, idle)!.open!;
  assert.equal(open.holdUntil, null);
  const later = T + 8 * 3_600_000;
  const play = watchingFacts({ itemId: "42", paused: false }, { id: "42", title: "Frieren", subtitle: "S01E05" });
  assert.deepEqual(planStateObservation("watching", open, later, play)?.closed, [{ ...idle, from: T, to: later }]);
  assert.deepEqual(stateSegments("watching", [], open, { from: later - M, to: later }).map((row) => [row.from, row.to]), [[later - M, later]]);
  const game = gamingFacts({ online: true, playing: { titleId: "PPSA01", title: "Pragmata" } });
  const gaming = planStateObservation("gaming", null, T, game)!.open!;
  assert.equal(planStateObservation("gaming", gaming, T + GAMING_HOLD_MS - 1, game)?.closed.length, 0);
  const confirmed = planStateObservation("gaming", gaming, T + 30 * M, game)!.open!;
  assert.deepEqual(planStateObservation("gaming", confirmed, T + 30 * M + GAMING_HOLD_MS + 1, game)?.closed, [{ ...game, from: T, to: T + 30 * M }]);
});

test("fact builders keep raw fields apart and never borrow another item's title", () => {
  assert.deepEqual(watchingFacts({ itemId: "77", paused: true }, { id: "42", title: "Frieren", subtitle: "" }),
    { state: "paused", itemId: "77", title: null, subtitle: null });
  assert.deepEqual(gamingFacts({ online: false, playing: null }), { state: "offline", titleId: null, title: null });
  const long = "x".repeat(500);
  assert.equal(watchingFacts({ itemId: "1", paused: false }, { id: "1", title: long, subtitle: "" }).title?.length, 200);
});

test("interval parsing drops malformed rows and unknown fields", () => {
  assert.equal(parseClosedInterval("listening", JSON.stringify({ ...playing, from: T, to: T })), null);
  assert.equal(parseClosedInterval("listening", JSON.stringify({ ...playing, state: "loud", from: T, to: T + 1 })), null);
  assert.equal(parseOpenInterval("gaming", "{"), null);
  assert.deepEqual(parseClosedInterval("gaming", JSON.stringify({ state: "online", titleId: null, title: null, from: T, to: T + 1, extra: "x" })),
    { state: "online", titleId: null, title: null, from: T, to: T + 1 });
});

test("state segments clip to the window, draw a live open interval to now and an expired one only to what is known", () => {
  const window = { from: T, to: T + 60 * M };
  const closed = [{ ...playing, from: T - 10 * M, to: T + 5 * M }];
  const fresh = stateSegments("listening", closed, { ...playing, from: T + 50 * M, seenAt: T + 58 * M, holdUntil: T + 68 * M, endsBy: null }, window);
  assert.deepEqual(fresh.map((row) => [row.from - T, row.to - T]), [[0, 5 * M], [50 * M, 60 * M]]);
  const stale = stateSegments("listening", closed, { ...playing, from: T + 30 * M, seenAt: T + 40 * M, holdUntil: T + 50 * M, endsBy: null }, window);
  assert.deepEqual(stale.map((row) => [row.from - T, row.to - T]), [[0, 5 * M], [30 * M, 40 * M]]);
});

test("charging gate: idle crossings are immediate, powered changes wait 30 s and must be significant, re-confirm after 5 min", () => {
  const first = planChargingSample(null, { t: T, watts: 45.04, device: "MacBook Pro" })!;
  assert.deepEqual(first, { t: T, watts: 45, device: "MacBook Pro" });
  assert.equal(planChargingSample(first, { t: T + 10_000, watts: 60, device: "MacBook Pro" }), null);
  assert.equal(planChargingSample(first, { t: T + 40_000, watts: 46, device: "MacBook Pro" }), null, "under 2 W");
  assert.ok(planChargingSample(first, { t: T + 40_000, watts: 60, device: "MacBook Pro" }));
  assert.ok(planChargingSample(first, { t: T + 1_000, watts: 0, device: "MacBook Pro" }), "unplugging is immediate");
  const idle = { t: T, watts: 0.3 };
  assert.equal(planChargingSample(idle, { t: T + 40_000, watts: 0.8 }), null, "flutter below the idle line");
  assert.ok(planChargingSample(idle, { t: T + 5 * M, watts: 0.3 }));
});

test("charging segments leave outages unknown; summary and sessions integrate held samples", () => {
  const samples = [{ t: T, watts: 0 }, { t: T + M, watts: 60 }, { t: T + 6 * M, watts: 60 }, { t: T + 30 * M, watts: 20 }];
  const segments = chargingSegments(samples, { from: T, to: T + 60 * M });
  assert.deepEqual(segments.map((row) => [row.from - T, row.to - T, row.watts]), [[0, M, 0], [M, 16 * M, 60], [30 * M, 40 * M, 20]]);
  assert.deepEqual(chargingSummary(segments), { peakW: 60, energyWh: Math.round((60 * 0.25 + 20 / 6) * 10) / 10 });
  assert.equal(currentChargingPower(samples, T + 35 * M), 20);
  assert.equal(currentChargingPower(samples, T + 45 * M), null, "stale is unknown, not zero");
  assert.deepEqual(chargingSessions(samples, T + 60 * M).map((row) => [row.startedAt - T, row.endedAt - T, row.peakW, row.energyWh]), [
    [M, 16 * M, 60, 15],
    [30 * M, 40 * M, 20, 3.333],
  ]);
});

test("activity replacement reports the first changed index and ignores key order", () => {
  const bucket = (i: number, steps: number | null) => ({ from: T + i * 5 * M, to: T + (i + 1) * 5 * M, steps, moveKcal: null, exerciseMinutes: null });
  const previous = [bucket(0, 10), bucket(1, 20), bucket(2, 30)];
  const reordered = { exerciseMinutes: null, moveKcal: null, steps: 20, to: T + 10 * M, from: T + 5 * M };
  const same = replaceActivityBuckets(previous, { from: T + 5 * M, to: T + 15 * M }, [reordered, bucket(2, 30)]);
  assert.equal(same.changed, false);
  const changed = replaceActivityBuckets(previous, { from: T + 5 * M, to: T + 15 * M }, [reordered, bucket(2, 35)]);
  assert.equal(changed.firstChanged, 2);
  assert.deepEqual(changed.next.map((row) => row.steps), [10, 20, 35]);
  const removed = replaceActivityBuckets(previous, { from: T + 5 * M, to: T + 15 * M }, []);
  assert.deepEqual(removed.next.map((row) => row.steps), [10], "omitted buckets inside the range become unknown");
});

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

test("state segments: a listening pause is drawn only up to the cap, and playing is never capped", () => {
  const paused: ListeningFacts = { ...playing, state: "paused" };
  const window = { from: T - M, to: T + 60 * M };
  const open = { ...paused, from: T, seenAt: T + 59 * M, holdUntil: T + 69 * M, endsBy: null };
  assert.deepEqual(stateSegments("listening", [], open, window).map((row) => [row.from - T, row.to - T]), [[0, LISTENING_PAUSE_MAX_MS]]);
  const closed = [{ ...paused, from: T, to: T + 30 * M }, { ...playing, from: T + 30 * M, to: T + 55 * M }];
  assert.deepEqual(stateSegments("listening", closed, null, window).map((row) => [row.state, row.to - row.from]),
    [["paused", LISTENING_PAUSE_MAX_MS], ["playing", 25 * M]]);
});

test("state observation: a pause with no playing before it is idle, a pause after playing stays a pause", () => {
  const paused: ListeningFacts = { ...playing, state: "paused" };
  const idle: ListeningFacts = { state: "idle", source: null, title: null, artist: null, album: null, trackId: null };
  const cold = planStateObservation("listening", null, T, paused)!.open!;
  assert.equal(cold.state, "idle", "Mac came online already paused");
  assert.equal(planStateObservation("listening", cold, T + 30_000, paused), null, "and keeps being idle");
  const open = planStateObservation("listening", null, T, playing)!.open!;
  assert.equal(planStateObservation("listening", open, T + M, paused)!.open!.state, "paused");
  const lapsed = planStateObservation("listening", open, T + 30 * M, paused)!;
  assert.deepEqual(lapsed.open && lapsed.open.state, "idle", "the hold ran out before this pause was seen");
  assert.deepEqual(idle.state, "idle");
});
