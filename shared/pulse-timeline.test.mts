import assert from "node:assert/strict";
import test from "node:test";

import {
  GAMING_HOLD_MS,
  PULSE_STATE_HOLD_MS,
  gamingFacts,
  parseClosedInterval,
  parseOpenInterval,
  planStateObservation,
  LISTENING_PAUSE_MAX_MS,
  stateSegments,
  watchingFacts,
  type ListeningFacts,
} from "@shared/pulse-timeline";

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
