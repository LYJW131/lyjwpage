import assert from "node:assert/strict";
import test from "node:test";

import { trackLookupCacheKey } from "@shared/apple-music";
import { installAppleCache } from "@shared/apple-cache";
import { lyricsCacheKey } from "@shared/lyrics";
import { motionArtworkCacheKey } from "@shared/motion-artwork";
import { parseAppleMusicUrl } from "@shared/motion-artwork-url";
import { MemoryKv } from "@shared/testing/memory-kv";
import { enrichTrack, lyricsToPrewarm, trackKeyOf } from "@shared/track-enrichment";
import type { LocalNowPlaying } from "@shared/types";
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
  const seededKv = seeded();
  installAppleCache(() => seededKv);
  t.after(() => installAppleCache(null));
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
  installAppleCache(() => kv);
  t.after(() => installAppleCache(null));
  const { value } = await withoutNetwork(() => enrichTrack(music("Unknown")));
  assert.equal(value?.songId, null);
  assert.equal(value?.motion, null);
  assert.equal(kv.writes, 0);
});

test("停止或没有歌名的播放不补全", async () => {
  assert.equal(await enrichTrack(music("Song", { state: "stopped" })), null);
  assert.equal(await enrichTrack(music("", { title: null })), null);
});

test("KV 过期时间不短于 60 秒", async (t) => {
  const kv = new TtlKv();
  installAppleCache(() => kv);
  t.after(() => installAppleCache(null));
  const { put } = await import("@shared/apple-cache");
  await withRequestState(() => put("short", { ok: true }, 5_000));
  assert.equal(kv.ttls.get("lyjwpage:short"), 60);
});

test("查到的结果存 30 天，否定结果 7 天，空歌词 1 小时", async () => {
  const { lyricsTtlMs } = await import("@shared/lyrics");
  const { motionTtlMs } = await import("@shared/motion-artwork");
  const { trackLookupTtlMs } = await import("@shared/apple-music");
  const DAY = 24 * 60 * 60 * 1000;
  assert.equal(lyricsTtlMs({ lines: [{ text: "x" }] as never }), 30 * DAY);
  assert.equal(lyricsTtlMs({ lines: [] }), 60 * 60 * 1000);
  assert.equal(motionTtlMs({ hasMotion: true, videoUrl: "https://mvod/x.m3u8", colors: null }), 30 * DAY);
  assert.equal(motionTtlMs({ hasMotion: false, videoUrl: null, colors: null }), 7 * DAY);
  const found = { link: LINK, artwork: null, id: "1", songId: "2", hasLyrics: true };
  assert.equal(trackLookupTtlMs(found), 30 * DAY);
  assert.equal(trackLookupTtlMs({ ...found, hasLyrics: false }), 7 * DAY);
  assert.equal(trackLookupTtlMs({ ...found, link: "" }), 7 * DAY);
});

test("动态封面：Apple 404 按「没有」缓存 7 天，其他错误不缓存", async (t) => {
  const { resolveMotionArtwork } = await import("@shared/motion-artwork");
  const kv = new TtlKv();
  kv.values.set("lyjwpage:apple-web-token", JSON.stringify({ token: "web-token", expiresAt: Date.now() + 3_600_000 }));
  installAppleCache(() => kv);
  t.after(() => installAppleCache(null));
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  const reply = (status: number) => { globalThis.fetch = (async () => new Response("{}", { status })) as typeof fetch; };

  reply(404);
  const missing = parseAppleMusicUrl("https://music.apple.com/us/album/x/404404")!;
  assert.deepEqual(await withRequestState(() => resolveMotionArtwork(missing)), { hasMotion: false, videoUrl: null, colors: null });
  assert.equal(kv.ttls.get(`lyjwpage:${motionArtworkCacheKey(missing)}`), 7 * 24 * 60 * 60);

  reply(500);
  const broken = parseAppleMusicUrl("https://music.apple.com/us/album/x/500500")!;
  await assert.rejects(withRequestState(() => resolveMotionArtwork(broken)));
  assert.equal(kv.values.has(`lyjwpage:${motionArtworkCacheKey(broken)}`), false);
});

function captureWarnings(t: { after: (fn: () => void) => void }): unknown[][] {
  const warnings: unknown[][] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => { warnings.push(args); };
  t.after(() => { console.warn = original; });
  return warnings;
}

test("动态封面卡住不拖住目录结果，超时打 warn 并标成未知", async (t) => {
  const kv = seeded();
  kv.values.delete(`lyjwpage:${motionArtworkCacheKey(parseAppleMusicUrl(LINK)!)}`);
  installAppleCache(() => kv);
  t.after(() => installAppleCache(null));
  const warnings = captureWarnings(t);
  const original = globalThis.fetch;
  globalThis.fetch = (() => new Promise<Response>(() => {})) as typeof fetch;
  t.after(() => { globalThis.fetch = original; });
  const { enrichTrackOutcome } = await import("@shared/track-enrichment");
  const started = Date.now();
  const outcome = await withRequestState(() => enrichTrackOutcome(music("Song"), [], { catalogMs: 2_000, upcomingMs: 2_000, motionMs: 30 }));
  assert.ok(Date.now() - started < 1_000);
  assert.equal(outcome?.enrichment.songId, "1501");
  assert.equal(outcome?.enrichment.link, LINK);
  assert.equal(outcome?.enrichment.motion, null);
  assert.equal(outcome?.catalogKnown, true);
  assert.equal(outcome?.motionKnown, false);
  assert.ok(warnings.some((args) => args[0] === "[enrichment]" && args[1] === "motion" && args[2] === "timed out" && args.includes("Song")));
});

test("队列里某首查询卡住只丢那一首", async (t) => {
  const kv = seeded();
  const stuck = trackLookupCacheKey({ title: "Stuck", artist: "Artist", album: null });
  const get = kv.get.bind(kv);
  kv.get = (key: string) => (key === `lyjwpage:${stuck}` ? new Promise<string | null>(() => {}) : get(key));
  installAppleCache(() => kv);
  t.after(() => installAppleCache(null));
  captureWarnings(t);
  const { enrichTrackOutcome } = await import("@shared/track-enrichment");
  const upcoming = [{ title: "Stuck", artist: "Artist", album: null }, { title: "Next", artist: "Artist", album: null }];
  const outcome = await withRequestState(() => enrichTrackOutcome(music("Song"), upcoming, { catalogMs: 2_000, upcomingMs: 30, motionMs: 2_000 }));
  assert.equal(outcome?.enrichment.songId, "1501");
  assert.deepEqual(outcome?.enrichment.upcomingSongIds, ["1502"]);
  assert.equal(outcome?.catalogKnown, true);
  assert.equal(outcome?.motionKnown, true);
  assert.equal(outcome?.upcomingKnown, false);
});

test("目录查询超时打 warn（带曲目与阶段），存成未补全并标成未知", async (t) => {
  const kv = new TtlKv();
  kv.get = () => new Promise<string | null>(() => {});
  installAppleCache(() => kv);
  t.after(() => installAppleCache(null));
  const warnings = captureWarnings(t);
  const { enrichTrackOutcome } = await import("@shared/track-enrichment");
  const outcome = await withRequestState(() => enrichTrackOutcome(music("Slow Song"), [], { catalogMs: 30, upcomingMs: 30, motionMs: 30 }));
  assert.equal(outcome?.enrichment.songId, null);
  assert.match(outcome?.enrichment.link ?? "", /music\.apple\.com\/search/);
  assert.equal(outcome?.catalogKnown, false);
  assert.deepEqual(warnings.find((args) => args[1] === "catalog")?.slice(0, 4), ["[enrichment]", "catalog", "timed out", "30ms"]);
  assert.ok(warnings.some((args) => args[1] === "catalog" && args.includes("Slow Song")));
});

test("目录里确定没有的曲目不算未知，不触发重查", async (t) => {
  const kv = new TtlKv();
  kv.values.set(`lyjwpage:${trackLookupCacheKey(music("Missing"))}`, JSON.stringify({ link: "", artwork: null, id: null, songId: null, hasLyrics: false }));
  installAppleCache(() => kv);
  t.after(() => installAppleCache(null));
  const { enrichTrackOutcome } = await import("@shared/track-enrichment");
  const { value } = await withoutNetwork(() => enrichTrackOutcome(music("Missing")));
  assert.equal(value?.catalogKnown, true);
  assert.equal(value?.upcomingKnown, true);
  assert.equal(value?.motionKnown, true);
});

test("超长歌名的目录缓存键不超过 KV 键长", () => {
  const short = trackLookupCacheKey(music("Song"));
  assert.equal(short, "apple-music:track-lookup:v11:song:artist:album");
  const long = trackLookupCacheKey(music("长".repeat(400)));
  assert.ok(new TextEncoder().encode(`lyjwpage:${long}`).length < 512);
  assert.notEqual(long, trackLookupCacheKey(music("长".repeat(401))));
});

test("lyrics are prewarmed for the playing track and the queue ahead, since the public endpoint only reads that cache", () => {
  const enrichment = { trackKey: "k", id: "1500", link: LINK, songId: "1501", artwork: null, hasLyrics: true, upcomingSongIds: ["1502", "1501", "1503"], motion: null };
  assert.deepEqual(lyricsToPrewarm(enrichment), ["1501", "1502", "1503"]);
  assert.deepEqual(lyricsToPrewarm({ ...enrichment, hasLyrics: false }), ["1502", "1501", "1503"]);
  assert.deepEqual(lyricsToPrewarm(null), []);
});
