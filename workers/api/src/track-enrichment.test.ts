import assert from "node:assert/strict";
import test from "node:test";

import { candidateFrom, trackKeyOf } from "@shared/track-enrichment";
import type { LocalNowPlaying } from "@shared/types";
import { withRequestState } from "@shared/request-state";

const LINK = "https://music.apple.com/cn/album/song/1500?i=1501";

function music(title: string, partial: Partial<LocalNowPlaying> = {}): LocalNowPlaying {
  return {
    source: "apple-music", state: "playing", title, artist: "Artist", album: "Album", trackId: null,
    artworkUrl: null, positionMs: 0, durationMs: 180_000, repeatOne: false, observedAt: 0, ...partial,
  };
}

async function withoutNetwork<T>(run: () => Promise<T>): Promise<{ value: T; fetched: string[] }> {
  const fetched: string[] = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    fetched.push(String(input));
    throw new Error("network disabled in test");
  }) as typeof fetch;
  try {
    return { value: await withRequestState(run), fetched };
  } finally {
    globalThis.fetch = original;
  }
}

test("补全结果对不上当前曲目时按未补全处理", () => {
  const enrichment = {
    trackKey: trackKeyOf(music("Old")), id: "1", link: LINK, songId: "2", artwork: "https://art/old.jpg",
    hasLyrics: true, upcomingSongIds: ["3"], motion: { videoUrl: "https://mvod/old.m3u8", colors: null },
  };
  const stale = candidateFrom(music("New"), 10, enrichment);
  assert.equal(stale?.songId, null);
  assert.equal(stale?.motion, null);
  assert.equal(stale?.music.artworkUrl, null);
  const fresh = candidateFrom(music("Old"), 10, enrichment);
  assert.equal(fresh?.songId, "2");
  assert.equal(fresh?.music.artworkUrl, "https://art/old.jpg");
  assert.deepEqual(fresh?.motion, { videoUrl: "https://mvod/old.m3u8", colors: null });
});

test("listening/now 读取只用存好的补全，不发外部请求", async (t) => {
  const { FakeStorage, installTestStorage } = await import("@shared/testing/fake-storage");
  const { mirror: telemetry } = await import("@shared/telemetry");
  const { mirror: liveness } = await import("@shared/reporter-liveness");
  const { getNowListening } = await import("./telemetry");
  installTestStorage(new FakeStorage());
  t.after(() => installTestStorage(null));
  const now = Date.now();
  const playing = music("Song", { observedAt: now });
  await liveness.put({ lastSeenAt: now, declaredOffline: false });
  await telemetry.merge({
    desktop: null, timezone: null, music: playing, upcomingTracks: [],
    musicEnrichment: {
      trackKey: trackKeyOf(playing), id: "1500", link: LINK, songId: "1501", artwork: null,
      hasLyrics: true, upcomingSongIds: [], motion: { videoUrl: "https://mvod/x.m3u8", colors: null },
    },
    activityReceivedAt: now, timezoneReceivedAt: 0, telemetryReceivedAt: now, activeModules: ["appleMusic"],
  }, ["music", "musicEnrichment", "upcomingTracks", "activityReceivedAt", "telemetryReceivedAt", "activeModules"]);
  const { value, fetched } = await withoutNetwork(() => getNowListening());
  assert.deepEqual(fetched, []);
  assert.equal(value.songId, "1501");
  assert.equal(value.link, LINK);
  assert.deepEqual(value.motion, { videoUrl: "https://mvod/x.m3u8", colors: null });
});

test("同一曲目这次没查到时沿用已存补全，换了曲目不沿用", async () => {
  const { keepEnrichment } = await import("@shared/track-enrichment");
  const good = {
    trackKey: trackKeyOf(music("Song")), id: "1500", link: LINK, songId: "1501", artwork: null,
    hasLyrics: true, upcomingSongIds: [], motion: null,
  };
  const failed = { ...good, link: "https://music.apple.com/search?term=Song", songId: null, id: null, hasLyrics: false };
  assert.deepEqual(keepEnrichment(music("Song"), failed, good, true), good);
  assert.equal(keepEnrichment(music("Song"), null, good, true), good);
  assert.equal(keepEnrichment(music("Other"), null, good, true), null);
  const fresh = { ...good, songId: "9" };
  assert.equal(keepEnrichment(music("Song"), fresh, good, true), fresh);
});

test("沿用已存补全时队列 ID 跟着本次上报的队列走", async () => {
  const { keepEnrichment } = await import("@shared/track-enrichment");
  const good = {
    trackKey: trackKeyOf(music("Song")), id: "1500", link: LINK, songId: "1501", artwork: null,
    hasLyrics: true, upcomingSongIds: ["old-1", "old-2"], motion: null,
  };
  const failed = { ...good, songId: null, id: null, upcomingSongIds: ["new-1"] };
  assert.deepEqual(keepEnrichment(music("Song"), failed, good, false), { ...good, upcomingSongIds: ["new-1"] });
  assert.deepEqual(keepEnrichment(music("Song"), failed, good, true), good);
  const partial = { ...good, upcomingSongIds: ["old-1"] };
  assert.deepEqual(keepEnrichment(music("Song"), partial, good, true), good);
  assert.equal(keepEnrichment(music("Song"), partial, good, false), partial);
});

test("补写按块合并：只在多出目录、动态封面或队列歌曲时生效", async () => {
  const { mergeEnrichment } = await import("@shared/track-enrichment");
  const found = {
    trackKey: trackKeyOf(music("Song")), id: "1500", link: LINK, songId: "1501", artwork: null,
    hasLyrics: true, upcomingSongIds: [], motion: null,
  };
  const missing = { ...found, songId: null, id: null };
  const withMotion = { ...found, motion: { videoUrl: "https://mvod/x.m3u8", colors: null } };
  assert.deepEqual(mergeEnrichment(missing, found, true), found);
  assert.deepEqual(mergeEnrichment(null, found, true), found);
  assert.equal(mergeEnrichment(null, missing, true), null);
  assert.equal(mergeEnrichment(found, found, true), null);
  assert.deepEqual(mergeEnrichment(found, withMotion, true), withMotion);
  assert.equal(mergeEnrichment(withMotion, found, true), null);

  const queued = { ...found, upcomingSongIds: ["1502", "1503"] };
  assert.deepEqual(mergeEnrichment(found, queued, true), queued);
  assert.equal(mergeEnrichment(found, queued, false), null);
  assert.equal(mergeEnrichment(queued, { ...found, upcomingSongIds: ["1502"] }, true), null);
  const stale = { ...withMotion, upcomingSongIds: ["old"] };
  assert.deepEqual(mergeEnrichment({ ...found, upcomingSongIds: ["new"] }, stale, false), { ...withMotion, upcomingSongIds: ["new"] });
  assert.deepEqual(mergeEnrichment(null, stale, false), { ...stale, upcomingSongIds: [] });
});
