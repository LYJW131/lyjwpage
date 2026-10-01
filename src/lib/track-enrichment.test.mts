import assert from "node:assert/strict";
import test from "node:test";

import { trackLookupCacheKey } from "@/lib/apple-music";
import { installAppleCacheForTests } from "@/lib/apple-cache-store";
import { lyricsCacheKey } from "@/lib/lyrics";
import { motionArtworkCacheKey } from "@/lib/motion-artwork";
import { parseAppleMusicUrl } from "@/lib/motion-artwork-url";
import { MemoryKv } from "@/lib/testing/memory-kv";
import { candidateFrom, enrichTrack, trackKeyOf } from "@/lib/track-enrichment";
import type { LocalNowPlaying } from "@/lib/types";
import { withRequestState } from "@shared/request-state";

const LINK = "https://music.apple.com/cn/album/song/1500?i=1501";

function music(title: string, partial: Partial<LocalNowPlaying> = {}): LocalNowPlaying {
  return {
    source: "apple-music", state: "playing", title, artist: "Artist", album: "Album", trackId: null,
    artworkUrl: null, positionMs: 0, durationMs: 180_000, repeatOne: false, observedAt: 0, ...partial,
  };
}

class TtlKv extends MemoryKv {
  ttls = new Map<string, number>();
  override async put(key: string, value: string, options?: { expirationTtl: number }): Promise<void> {
    await super.put(key, value);
    if (options) this.ttls.set(key, options.expirationTtl);
  }
}

function seeded(): TtlKv {
  const kv = new TtlKv();
  const seed = (k: string, value: unknown) => kv.values.set(`lyjwpage:${k}`, JSON.stringify(value));
  seed(trackLookupCacheKey(music("Song")), { link: LINK, artwork: "https://art/{w}x{h}.jpg", id: "1500", songId: "1501", hasLyrics: true });
  seed(trackLookupCacheKey({ title: "Next", artist: "Artist", album: null }), { link: LINK, artwork: null, id: "1500", songId: "1502", hasLyrics: false });
  seed(lyricsCacheKey("1501"), { lines: [] });
  seed(motionArtworkCacheKey(parseAppleMusicUrl(LINK)!), { hasMotion: true, videoUrl: "https://mvod/x.m3u8", colors: ["#000", "#fff"] });
  return kv;
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

test("缓存命中时补全全部来自 KV，不发外部请求", async (t) => {
  installAppleCacheForTests(seeded());
  t.after(() => installAppleCacheForTests(null));
  const { value, fetched } = await withoutNetwork(() => enrichTrack(music("Song"), [{ title: "Next", artist: "Artist", album: null }]));
  assert.deepEqual(fetched, []);
  assert.deepEqual(value, {
    trackKey: trackKeyOf(music("Song")),
    id: "1500",
    link: LINK,
    songId: "1501",
    artwork: "https://art/{w}x{h}.jpg",
    hasLyrics: true,
    upcomingSongIds: ["1502"],
    motion: { videoUrl: "https://mvod/x.m3u8", colors: ["#000", "#fff"] },
  });
});

test("查询失败时存成未补全，失败结果不写 KV", async (t) => {
  const kv = new TtlKv();
  installAppleCacheForTests(kv);
  t.after(() => installAppleCacheForTests(null));
  const { value } = await withoutNetwork(() => enrichTrack(music("Unknown")));
  assert.equal(value?.songId, null);
  assert.equal(value?.motion, null);
  assert.equal(kv.writes, 0);
});

test("停止或没有歌名的播放不补全", async () => {
  assert.equal(await enrichTrack(music("Song", { state: "stopped" })), null);
  assert.equal(await enrichTrack(music("", { title: null })), null);
});

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

test("KV 过期时间不短于 60 秒", async (t) => {
  const kv = new TtlKv();
  installAppleCacheForTests(kv);
  t.after(() => installAppleCacheForTests(null));
  const { put } = await import("@/lib/apple-cache");
  await withRequestState(() => put("short", { ok: true }, 5_000));
  assert.equal(kv.ttls.get("lyjwpage:short"), 60);
});

test("listening/now 读取只用存好的补全，不发外部请求", async (t) => {
  const { FakeStorage } = await import("@/lib/testing/fake-storage");
  const { installStorageForTests, resetStorageForTests } = await import("@/lib/storage");
  const { mirror: telemetry } = await import("@shared/telemetry");
  const { mirror: liveness } = await import("@shared/reporter-liveness");
  const { getNowListening } = await import("@/lib/telemetry");
  installStorageForTests(new FakeStorage());
  installAppleCacheForTests(new TtlKv());
  t.after(() => { resetStorageForTests(); installAppleCacheForTests(null); });
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
  const { keepEnrichment } = await import("@/lib/track-enrichment");
  const good = {
    trackKey: trackKeyOf(music("Song")), id: "1500", link: LINK, songId: "1501", artwork: null,
    hasLyrics: true, upcomingSongIds: [], motion: null,
  };
  const failed = { ...good, link: "https://music.apple.com/search?term=Song", songId: null, id: null, hasLyrics: false };
  assert.equal(keepEnrichment(music("Song"), failed, good), good);
  assert.equal(keepEnrichment(music("Song"), null, good), good);
  assert.equal(keepEnrichment(music("Other"), null, good), null);
  const fresh = { ...good, songId: "9" };
  assert.equal(keepEnrichment(music("Song"), fresh, good), fresh);
});

test("确定的结果长存：歌词与动态封面都存 30 天，空歌词短存", async () => {
  const { lyricsTtlMs } = await import("@/lib/lyrics");
  const { motionTtlMs } = await import("@/lib/motion-artwork");
  const DAY = 24 * 60 * 60 * 1000;
  assert.equal(lyricsTtlMs({ lines: [{ text: "x" }] as never }), 30 * DAY);
  assert.equal(lyricsTtlMs({ lines: [] }), 60 * 60 * 1000);
  assert.equal(motionTtlMs(), 30 * DAY);
});

test("动态封面：Apple 404 按「没有」缓存 30 天，其他错误不缓存", async (t) => {
  const { resolveMotionArtwork } = await import("@/lib/motion-artwork");
  const kv = new TtlKv();
  kv.values.set("lyjwpage:apple-web-token", JSON.stringify({ token: "web-token", expiresAt: Date.now() + 3_600_000 }));
  installAppleCacheForTests(kv);
  t.after(() => installAppleCacheForTests(null));
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const reply = (status: number) => { globalThis.fetch = (async () => new Response("{}", { status })) as typeof fetch; };

  reply(404);
  const missing = parseAppleMusicUrl("https://music.apple.com/us/album/x/404404")!;
  assert.deepEqual(await withRequestState(() => resolveMotionArtwork(missing)), { hasMotion: false, videoUrl: null, colors: null });
  assert.equal(kv.ttls.get(`lyjwpage:${motionArtworkCacheKey(missing)}`), 30 * 24 * 60 * 60);

  reply(500);
  const broken = parseAppleMusicUrl("https://music.apple.com/us/album/x/500500")!;
  await assert.rejects(withRequestState(() => resolveMotionArtwork(broken)));
  assert.equal(kv.values.has(`lyjwpage:${motionArtworkCacheKey(broken)}`), false);
});
