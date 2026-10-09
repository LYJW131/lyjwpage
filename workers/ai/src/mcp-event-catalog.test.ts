import assert from "node:assert/strict";
import test from "node:test";

import {
  detectWatchingChange,
  EVENT_DEFINITIONS,
  EVENT_NAME,
  matchesEventArguments,
  parseEventArguments,
  readWatchingSnapshot,
  snapshotKey,
  WATCHING_CHANGES,
  WATCHING_STATUS_PATH,
  type WatchingSnapshot,
} from "./mcp-event-catalog.ts";

const idle: WatchingSnapshot = { itemId: null, title: null, paused: null };
const playing: WatchingSnapshot = { itemId: "episode-1", title: "Example series", paused: false };
const paused: WatchingSnapshot = { ...playing, paused: true };
const switched: WatchingSnapshot = { ...playing, itemId: "episode-2" };
const now = 1_791_504_000_000;

function envelope(playback: unknown = { itemId: playing.itemId, paused: false }, current: unknown = { id: playing.itemId, title: playing.title }) {
  return { ok: true, data: { nowPlaying: playback, current } };
}

test("catalog exposes only the webhook watching event and a scalar optional filter", () => {
  assert.equal(EVENT_NAME, "watching-now");
  assert.equal(WATCHING_STATUS_PATH, "/api/status/watching/now");
  assert.equal(EVENT_DEFINITIONS.length, 1);
  assert.deepEqual(EVENT_DEFINITIONS[0].delivery, ["webhook"]);
  assert.deepEqual(EVENT_DEFINITIONS[0].inputSchema.properties.change.enum, WATCHING_CHANGES);
  assert.equal(EVENT_DEFINITIONS[0].inputSchema.additionalProperties, false);
  assert.deepEqual(parseEventArguments(undefined), {});
  assert.deepEqual(parseEventArguments({}), {});
  for (const change of WATCHING_CHANGES) assert.deepEqual(parseEventArguments({ change }), { change });
});

test("subscription filters reject null, arrays, nested values and unknown fields", () => {
  for (const value of [
    null, [], "started", 1,
    { change: null }, { change: [] }, { change: {} }, { change: undefined },
    { change: "STARTED" }, { change: "anything" }, { unexpected: true },
    { change: "started", extra: "ignored?" },
  ]) {
    assert.throws(() => parseEventArguments(value));
  }
});

test("public snapshot keeps only the playback identity, title and pause state", () => {
  const value = envelope({ itemId: playing.itemId, paused: false, positionMs: 4000, deviceName: "private device", media: { subtitle: { path: "/private.srt" } } }, {
    id: playing.itemId, title: playing.title, poster: "/img/a", link: "https://example.test/private", subtitle: "S1:E1", credential: "never-copy",
  });
  assert.deepEqual(readWatchingSnapshot(value), playing);
  assert.deepEqual(readWatchingSnapshot(envelope(null, null)), idle);
  assert.deepEqual(readWatchingSnapshot({ ok: true, data: { nowPlaying: null } }), idle);
  assert.deepEqual(readWatchingSnapshot(envelope({ itemId: playing.itemId, paused: true }, null)), { ...paused, title: null });
});

test("invalid public response shapes fail without manufacturing stopped playback", () => {
  for (const value of [
    undefined, null, [], {},
    { ok: false, data: { nowPlaying: null } },
    { ok: true, data: null },
    { ok: true, data: {} },
    { ok: true, data: { nowPlaying: undefined, current: null } },
    envelope([], null),
    envelope({ paused: false }, null),
    envelope({ itemId: " ", paused: false }, null),
    envelope({ itemId: "x", paused: "false" }, null),
    envelope({ itemId: "x".repeat(1025), paused: false }, null),
    envelope({ itemId: "x", paused: false }, { id: "other", title: "wrong item" }),
    envelope({ itemId: "x", paused: false }, { id: "x", title: 5 }),
    envelope({ itemId: "x", paused: false }, { id: "x", title: "x".repeat(2049) }),
  ]) {
    assert.throws(() => readWatchingSnapshot(value));
  }
  assert.throws(() => readWatchingSnapshot({ ok: true, data: { nowPlaying: { itemId: "x", paused: false } } }));
});

test("progress, images and title enrichment cannot create a watching event", () => {
  const a = readWatchingSnapshot(envelope({ itemId: playing.itemId, paused: false, positionMs: 5 }));
  const b = readWatchingSnapshot(envelope({ itemId: playing.itemId, paused: false, positionMs: 1000 }, { id: playing.itemId, title: "Enriched title", poster: "/img/new" }));
  assert.equal(snapshotKey(a), snapshotKey(b));
  assert.equal(detectWatchingChange(a, b, now, 1), null);
  assert.equal(detectWatchingChange(idle, idle, now, 1), null);
});

test("playback transitions distinguish start, switch, pause, resume and stop", () => {
  for (const [before, after, change] of [
    [idle, playing, "started"],
    [idle, paused, "started"],
    [playing, switched, "changed"],
    [paused, { ...switched, paused: true }, "changed"],
    [playing, paused, "paused"],
    [paused, playing, "resumed"],
    [playing, idle, "stopped"],
    [paused, idle, "stopped"],
  ] as const) {
    assert.deepEqual(detectWatchingChange(before, after, now, 7), { ...after, change, detectedAt: now, sequence: 7 });
  }
});

test("event timestamps and sequences must be safe nonnegative and positive integers", () => {
  for (const timestamp of [-1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => detectWatchingChange(idle, playing, timestamp, 1));
  }
  for (const sequence of [-1, 0, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => detectWatchingChange(idle, playing, now, sequence));
  }
});

test("filters select one semantic change or allow every change when omitted", () => {
  const payload = detectWatchingChange(playing, paused, now, 1)!;
  assert.equal(matchesEventArguments({}, payload), true);
  for (const change of WATCHING_CHANGES) {
    assert.equal(matchesEventArguments({ change }, payload), change === "paused");
  }
  assert.deepEqual(Object.keys(payload).sort(), EVENT_DEFINITIONS[0].payloadSchema.required.toSorted());
  assert.equal("instructions" in payload, false);
});
