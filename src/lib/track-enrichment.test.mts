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
  assert.deepEqual(keepEnrichment(music("Song"), failed, good, true), good);
  assert.equal(keepEnrichment(music("Song"), null, good, true), good);
  assert.equal(keepEnrichment(music("Other"), null, good, true), null);
  const fresh = { ...good, songId: "9" };
  assert.equal(keepEnrichment(music("Song"), fresh, good, true), fresh);
});

test("同一 songId 这次没查出动态封面时留着已存视频，换了 songId 不留", async () => {
  const { keepEnrichment } = await import("@/lib/track-enrichment");
  const video = { videoUrl: "https://mvod/x.m3u8", colors: ["#000", "#fff"] as string[] | null };
  const stored = {
    trackKey: trackKeyOf(music("Song")), id: "1500", link: LINK, songId: "1501", artwork: "https://art/old.jpg",
    hasLyrics: true, upcomingSongIds: [], motion: video,
  };
  const unknown = { ...stored, artwork: "https://art/new.jpg", motion: null };
  assert.deepEqual(keepEnrichment(music("Song"), unknown, stored, true), { ...unknown, motion: video });
  const replaced = { ...unknown, motion: { videoUrl: "https://mvod/y.m3u8", colors: null } };
  assert.equal(keepEnrichment(music("Song"), replaced, stored, true), replaced);
  const other = { ...stored, songId: "9", motion: null };
  assert.equal(keepEnrichment(music("Song"), other, stored, true), other);
});

test("卡片记住同一首后到的视频，这次没带视频时不把已经显示的清掉", async () => {
  const { rememberLookup, shownMotion } = await import("@/lib/track-enrichment");
  const video = { videoUrl: "https://mvod/x.m3u8", colors: null };
  const base = {
    id: "1500", songId: "1501", link: LINK, upcomingSongIds: [] as string[], hasLyrics: true, motion: null,
  };
  const first = rememberLookup("song|artist|album", base, null);
  assert.equal(first?.motion, null);
  assert.equal(shownMotion(base, first), null);
  const arrived = rememberLookup("song|artist|album", { ...base, motion: video }, first);
  assert.deepEqual(arrived?.motion, video);
  assert.deepEqual(shownMotion({ songId: "1501", motion: null }, arrived), video);
  assert.equal(shownMotion({ songId: "9", motion: null }, arrived), null);
  assert.equal(rememberLookup("song|artist|album", { ...base, motion: video }, arrived), arrived);
});

test("播放器优先用已经存下的视频，没有时才用现查结果", async () => {
  const { heldVideoUrl, withHeldMotion } = await import("@/lib/track-enrichment");
  const video = { videoUrl: "https://mvod/x.m3u8", colors: null };
  assert.equal(heldVideoUrl(video, { hasMotion: false, videoUrl: null }), video.videoUrl);
  assert.equal(heldVideoUrl(null, { hasMotion: true, videoUrl: "https://mvod/y.m3u8" }), "https://mvod/y.m3u8");
  assert.equal(heldVideoUrl(null, null), null);
  const item = { id: "1500", motion: null as typeof video | null };
  assert.deepEqual(withHeldMotion(item, video), { ...item, motion: video });
  const held = { ...item, motion: video };
  assert.equal(withHeldMotion(held, { videoUrl: "https://mvod/y.m3u8", colors: null }), held);
});

test("沿用已存补全时队列 ID 跟着本次上报的队列走", async () => {
  const { keepEnrichment } = await import("@/lib/track-enrichment");
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

test("查到的结果存 30 天，否定结果 7 天，空歌词 1 小时", async () => {
  const { lyricsTtlMs } = await import("@/lib/lyrics");
  const { motionTtlMs } = await import("@/lib/motion-artwork");
  const { trackLookupTtlMs } = await import("@/lib/apple-music");
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
  installAppleCacheForTests(kv);
  t.after(() => installAppleCacheForTests(null));
  const warnings = captureWarnings(t);
  const original = globalThis.fetch;
  globalThis.fetch = (() => new Promise<Response>(() => {})) as typeof fetch;
  t.after(() => { globalThis.fetch = original; });
  const { enrichTrackOutcome } = await import("@/lib/track-enrichment");
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
  installAppleCacheForTests(kv);
  t.after(() => installAppleCacheForTests(null));
  captureWarnings(t);
  const { enrichTrackOutcome } = await import("@/lib/track-enrichment");
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
  installAppleCacheForTests(kv);
  t.after(() => installAppleCacheForTests(null));
  const warnings = captureWarnings(t);
  const { enrichTrackOutcome } = await import("@/lib/track-enrichment");
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
  installAppleCacheForTests(kv);
  t.after(() => installAppleCacheForTests(null));
  const { enrichTrackOutcome } = await import("@/lib/track-enrichment");
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

test("补写按块合并：只在多出目录、动态封面或队列歌曲时生效", async () => {
  const { mergeEnrichment } = await import("@/lib/track-enrichment");
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
