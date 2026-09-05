import assert from "node:assert/strict";
import test from "node:test";
import {
  boundedSeek,
  createPlaybackCommands,
  playbackDuration,
  playerQueue,
  playerTime,
} from "./music-player.ts";
import type { MusicKitInstance } from "./musickit.ts";

const record = {
  id: "album",
  title: "Album",
  artist: "Artist",
  artwork: null,
  url: "https://music.apple.com/cn/album/example/123",
};

test("playback resolves catalog songs, albums, playlists and stations without accepting unrelated URLs", () => {
  assert.deepEqual(playerQueue({ ...record, songId: "456" }), { song: "456" });
  for (const kind of ["album", "playlist", "station", "song"]) {
    const url = `https://music.apple.com/cn/${kind}/example/123`;
    assert.deepEqual(playerQueue({ ...record, url }), { url });
  }
  for (const url of [
    null,
    "javascript:alert(1)",
    "https://music.apple.com.evil.example/cn/album/x/1",
    "https://music.apple.com/cn/browse",
    "http://music.apple.com/cn/album/x/1",
  ]) {
    assert.equal(playerQueue({ ...record, url }), null);
  }
});

test("seek bounds reject invalid/live duration and keep positions within the actual track", () => {
  assert.equal(boundedSeek(-5, 180), 0);
  assert.equal(boundedSeek(200, 180), 180);
  assert.equal(boundedSeek(45.5, 180), 45.5);
  assert.equal(boundedSeek(100, Infinity), 0);
  assert.equal(boundedSeek(NaN, 180), 0);
  assert.equal(playerTime(NaN), "0:00");
  assert.equal(playerTime(3661.9), "61:01");
});

test("the player uses the playable duration and falls back to catalog milliseconds while loading", () => {
  const music = {
    currentPlaybackDuration: 180,
    nowPlayingItem: { attributes: { durationInMillis: 181000 } },
  } as MusicKitInstance;
  assert.equal(playbackDuration(music), 180);
  music.currentPlaybackDuration = NaN;
  assert.equal(playbackDuration(music), 181);
  music.nowPlayingItem = null;
  assert.equal(playbackDuration(music), 0);
});

test("cancel during authorization prevents late playback and drops previously queued changes before stopping", async () => {
  const commands = createPlaybackCommands();
  let authorized!: () => void;
  const gate = new Promise<void>((resolve) => {
    authorized = resolve;
  });
  const events: string[] = [];
  const first = commands.run(async (cancelled) => {
    events.push("authorize");
    await gate;
    if (!cancelled()) events.push("play");
  });
  await Promise.resolve();
  const second = commands.run(async () => {
    events.push("old-next");
  });
  commands.cancel();
  const stop = commands.run(async () => {
    events.push("stop");
  });
  authorized();
  await Promise.all([first, second, stop]);
  assert.deepEqual(events, ["authorize", "stop"]);
  await commands.run(async () => {
    events.push("new-play");
  });
  assert.deepEqual(events, ["authorize", "stop", "new-play"]);
});

test("failed loading does not break subsequent playback commands or let them overlap", async () => {
  const commands = createPlaybackCommands();
  const events: string[] = [];
  const failed = commands.run(async () => {
    events.push("load");
    throw new Error("unavailable");
  });
  const retry = commands.run(async () => {
    events.push("retry");
  });
  await assert.rejects(failed, /unavailable/);
  await retry;
  assert.deepEqual(events, ["load", "retry"]);
});
