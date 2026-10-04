import assert from "node:assert/strict";
import test from "node:test";

import {
  LISTENING_SESSION_GAP_MS,
  NEXT_IN_ORDER_MIN_RUN,
  inferredPlays,
  playingElsewhere,
  predictedNext,
  type ListeningTrace,
} from "@shared/pulse-listening";
import { loadRecordedSession, recordedContainer, replayNextAtCadence } from "@/lib/testing/listening-replay";
import type { PlayingContainer } from "@/lib/types";

const T = 1_800_000_000_000;
const S = 1000;
const SONG_MS = 200 * S;

function played(titles: string[], { from = T, gapAfter = -1, gapMs = 0 } = {}): ListeningTrace[] {
  let start = from;
  return titles.map((title, index) => {
    const trace: ListeningTrace = { since: start, t: start + 15 * S, title, artist: "YOASOBI", album: null, itemId: `i.${title}`, durationMs: SONG_MS, songId: title, artworkUrl: null };
    start += SONG_MS + (index === gapAfter ? gapMs : 0);
    return trace;
  });
}

function playlist(...titles: string[]): PlayingContainer {
  return { id: "pl.u-1", tracks: titles.map((title) => ({ id: `cat.${title}`, songId: title, title, artist: "YOASOBI", durationMs: SONG_MS, artworkUrl: `art/${title}/{w}x{h}bb.jpg` })) };
}

const next = (traces: ListeningTrace[], container: PlayingContainer | null = null) => predictedNext(inferredPlays(traces), container);

test("in order: guesses the following track only after enough songs in a row line up with the playlist", () => {
  const list = playlist("A", "B", "C", "D", "E");
  assert.equal(NEXT_IN_ORDER_MIN_RUN, 3);
  assert.equal(next(played(["A", "B"]), list), null, "two in a row is too easy to hit while shuffling");
  assert.deepEqual(next(played(["A", "B", "C"]), list), { title: "D", artist: "YOASOBI", songId: "D", artworkUrl: "art/D/{w}x{h}bb.jpg", durationMs: SONG_MS, basis: "order" });
  assert.equal(next(played(["X", "B", "C", "D"]), list)?.title, "E", "an earlier song from elsewhere does not break the run that follows");
});

test("in order: no guess on the last track, on a shuffled run, or without a track list", () => {
  assert.equal(next(played(["C", "D", "E"]), playlist("A", "B", "C", "D", "E")), null, "repeat all or stop is unknown");
  assert.equal(next(played(["E", "B", "D"]), playlist("A", "B", "C", "D", "E")), null);
  assert.equal(next(played(["A", "B", "C"]), null), null);
});

test("in order: songs match by catalog id, by item id, or by title and artist", () => {
  const byTitle: PlayingContainer = { id: "p.1", tracks: ["A", "B", "C", "D"].map((title) => ({ id: `i.lib-${title}`, songId: null, title, artist: "yoasobi", durationMs: null, artworkUrl: null })) };
  assert.equal(next(played(["A", "B", "C"]), byTitle)?.title, "D");
  const byItem: PlayingContainer = { id: "p.2", tracks: ["A", "B", "C", "D"].map((title) => ({ id: `i.${title}`, songId: null, title: `${title} (Live)`, artist: "YOASOBI", durationMs: null, artworkUrl: null })) };
  assert.equal(next(played(["A", "B", "C"]), byItem)?.title, "D (Live)");
});

test("in order: a song listed twice picks the place with the longest run, and gives up when two places tie on different songs", () => {
  assert.equal(next(played(["A", "B", "C"]), playlist("C", "X", "A", "B", "C", "D"))?.title, "D");
  assert.equal(next(played(["A", "B", "C"]), playlist("A", "B", "C", "D", "A", "B", "C", "E")), null);
  assert.equal(next(played(["A", "B", "C"]), playlist("A", "B", "C", "D", "A", "B", "C", "D"))?.title, "D", "both places agree");
});

test("loop: a hand-picked set is guessed once it has repeated in full, and wins over the playlist order", () => {
  assert.equal(next(played(["A", "B", "C", "A", "B"])), null, "not a full repeat yet");
  assert.deepEqual(next(played(["A", "B", "C", "A", "B", "C"])), { title: "A", artist: "YOASOBI", songId: "A", artworkUrl: null, durationMs: SONG_MS, basis: "loop" });
  assert.equal(next(played(["X", "Y", "A", "B", "A", "B"]))?.title, "A", "two songs back and forth");
  assert.equal(next(played(["A", "B", "C", "A", "B", "C"]), playlist("A", "B", "C", "D"))?.basis, "loop");
});

test("a long stop starts a new session: neither rule reaches back across it", () => {
  const list = playlist("A", "B", "C", "D", "E");
  assert.equal(next(played(["A", "B", "C"], { gapAfter: 1, gapMs: LISTENING_SESSION_GAP_MS + 60 * S }), list), null);
  assert.equal(next(played(["A", "B", "C"], { gapAfter: 1, gapMs: 60 * S }), list)?.title, "D", "a short pause keeps the run");
  assert.equal(next(played(["A", "B", "A", "B"], { gapAfter: 1, gapMs: LISTENING_SESSION_GAP_MS + 60 * S })), null);
});

test("the song likely playing elsewhere carries the guess", () => {
  const traces = played(["A", "B", "C"]);
  const elsewhere = playingElsewhere(traces, T + 2 * SONG_MS + 30 * S, playlist("A", "B", "C", "D"));
  assert.equal(elsewhere?.title, "C");
  assert.equal(elsewhere?.next?.title, "D");
  assert.equal(playingElsewhere(traces, T + 2 * SONG_MS + 30 * S)?.next, null);
});

test("a recorded iPhone session playing a playlist in order: the next song is never guessed wrong", () => {
  const session = loadRecordedSession();
  const container = recordedContainer(session);
  for (const cadenceMs of [15_000, 60_000, 300_000]) {
    const { right, wrong, silent } = replayNextAtCadence(session, container, cadenceMs);
    assert.equal(wrong, 0, `polled every ${cadenceMs} ms`);
    assert.ok(right > silent, `polled every ${cadenceMs} ms: right ${right}, silent ${silent}`);
  }
});
