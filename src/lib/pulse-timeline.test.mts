import assert from "node:assert/strict";
import test from "node:test";

import { listeningFacts, listeningTrace, parseListeningTrace } from "@shared/pulse-listening";
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
  stateSegments,
  watchingFacts,
  type ListeningFacts,
} from "@shared/pulse-timeline";
import type { ListeningItem, LocalNowPlaying } from "@/lib/types";

const T = 1_800_000_000_000;
const M = 60_000;

const playing: ListeningFacts = { state: "playing", source: "mac", title: "Helpless", artist: "Hamilton", album: "Hamilton", trackId: "1" };

test("state observation: first sighting opens, same facts only bump seenAt once a minute, a change closes at that moment", () => {
  const first = planStateObservation("listening", null, T, playing);
  assert.deepEqual(first, { closed: [], open: { ...playing, from: T, seenAt: T } });
  const open = first!.open!;
  assert.equal(planStateObservation("listening", open, T + 30_000, playing), null, "under a minute is not written");
  assert.equal(planStateObservation("listening", open, T, playing), null, "replays are dropped");
  assert.deepEqual(planStateObservation("listening", open, T + M, playing), { closed: [], open: { ...open, seenAt: T + M } });
  const next = { ...playing, title: "Satisfied" };
  assert.deepEqual(planStateObservation("listening", open, T + 3 * M, next), {
    closed: [{ ...playing, from: T, to: T + 3 * M }],
    open: { ...next, from: T + 3 * M, seenAt: T + 3 * M },
  });
});

test("state observation: a gap longer than the hold ends at the last confirmation; unobservable closes and leaves unknown", () => {
  const open = { ...playing, from: T, seenAt: T + 4 * M };
  const late = T + 4 * M + PULSE_STATE_HOLD_MS + 1;
  assert.deepEqual(planStateObservation("listening", open, late, playing), {
    closed: [{ ...playing, from: T, to: T + 4 * M }],
    open: { ...playing, from: late, seenAt: late },
  });
  assert.deepEqual(planStateObservation("listening", open, T + 5 * M, null), { closed: [{ ...playing, from: T, to: T + 5 * M }], open: null });
  // 单次观测之后就断流：零长度的段不留
  assert.deepEqual(planStateObservation("listening", { ...playing, from: T, seenAt: T }, late, null), { closed: [], open: null });
});

test("state observation: explicit Emby stop stays idle until the next play; PSN has a longer hold", () => {
  const idle = watchingFacts(null, null);
  const open = { ...idle, from: T, seenAt: T };
  const later = T + 8 * 3_600_000;
  const play = watchingFacts({ itemId: "42", paused: false }, { id: "42", title: "Frieren", subtitle: "S01E05" });
  assert.deepEqual(planStateObservation("watching", open, later, play)?.closed, [{ ...idle, from: T, to: later }]);
  const game = gamingFacts({ online: true, playing: { titleId: "PPSA01", title: "Pragmata" } });
  const gaming = { ...game, from: T, seenAt: T };
  assert.equal(planStateObservation("gaming", gaming, T + GAMING_HOLD_MS - 1, game)?.closed.length, 0);
  assert.deepEqual(planStateObservation("gaming", gaming, T + GAMING_HOLD_MS + 1, game)?.closed, []);
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

test("state segments clip to the window and draw a fresh open interval to now, a stale one only to its last confirmation", () => {
  const window = { from: T, to: T + 60 * M };
  const closed = [{ ...playing, from: T - 10 * M, to: T + 5 * M }];
  const fresh = stateSegments("listening", closed, { ...playing, from: T + 50 * M, seenAt: T + 58 * M }, window);
  assert.deepEqual(fresh.map((row) => [row.from - T, row.to - T]), [[0, 5 * M], [50 * M, 60 * M]]);
  const stale = stateSegments("listening", closed, { ...playing, from: T + 30 * M, seenAt: T + 40 * M }, window);
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

test("listening facts: Mac playing wins, then HomePod playing, then paused; paused has no grace period", () => {
  const homePod = { music: { ...macMusic("playing", "Satisfied"), source: "homepod" as const }, receivedAt: T };
  assert.equal(listeningFacts({ mac: macMusic("playing"), macObserved: true, homePod }, online, T)?.title, "Helpless");
  assert.deepEqual(listeningFacts({ mac: macMusic("paused"), macObserved: true, homePod }, online, T),
    { state: "playing", source: "homepod", title: "Satisfied", artist: "Hamilton", album: "Hamilton", trackId: "t1" });
  assert.equal(listeningFacts({ mac: macMusic("paused"), macObserved: true, homePod: null }, { ...online, lastSeenAt: T + 10 * M }, T + 10 * M)?.state, "paused");
  assert.equal(listeningFacts({ mac: macMusic("stopped"), macObserved: true, homePod: null }, online, T)?.state, "idle");
});

test("listening facts: an offline Mac without a live HomePod is unknown, not idle", () => {
  const offline = { lastSeenAt: T, declaredOffline: true };
  assert.equal(listeningFacts({ mac: macMusic("playing"), macObserved: true, homePod: null }, offline, T), null);
  assert.equal(listeningFacts({ mac: null, macObserved: false, homePod: null }, online, T), null, "appleMusic module off");
  const homePod = { music: { ...macMusic("playing", "Satisfied"), source: "homepod" as const }, receivedAt: T };
  assert.equal(listeningFacts({ mac: null, macObserved: false, homePod }, offline, T)?.source, "homepod");
});

const item = (id: string, title = id): ListeningItem => ({ id, title, artist: "YOASOBI" } as ListeningItem);

test("recently played traces: need a baseline, ignore cover-only changes, name the newly added item", () => {
  assert.equal(listeningTrace(null, { items: [item("a")], fetchedAt: T }), null);
  assert.equal(listeningTrace({ items: [item("a")], fetchedAt: T }, { items: [{ ...item("a"), artwork: "new" } as ListeningItem], fetchedAt: T + M }), null);
  assert.deepEqual(listeningTrace({ items: [item("a")], fetchedAt: T }, { items: [item("b", "THE BOOK 3"), item("a")], fetchedAt: T + 2 * M }),
    { since: T, t: T + 2 * M, title: "THE BOOK 3", artist: "YOASOBI", itemId: "b" });
  assert.equal(listeningTrace({ items: [item("a"), item("b")], fetchedAt: T }, { items: [item("b"), item("a")], fetchedAt: T + M })?.itemId, "b", "a replayed album moves to the front");
  assert.equal(parseListeningTrace(JSON.stringify({ since: T, t: T })), null);
  assert.equal(parseListeningTrace("{"), null);
});
