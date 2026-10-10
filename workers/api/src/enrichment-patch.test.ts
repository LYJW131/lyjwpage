import assert from "node:assert/strict";
import test from "node:test";

import { trackLookupCacheKey } from "@/lib/apple-music";
import { installAppleCacheForTests } from "../../../src/lib/apple-cache-store";
import { motionArtworkCacheKey } from "@/lib/motion-artwork";
import { parseAppleMusicUrl } from "@/lib/motion-artwork-url";
import { installStorageForTests, resetStorageForTests } from "@/lib/storage";
import { FakeStorage } from "@/lib/testing/fake-storage";
import { MemoryKv } from "@/lib/testing/memory-kv";
import { trackKeyOf, upcomingKeyOf } from "@/lib/track-enrichment";
import type { ListeningItem } from "@/lib/types";
import { mirror as recentMirror } from "@shared/apple-music-store";
import { mirror as homePodMirror } from "@shared/homepod-store";
import { prepareIngest, type CoreCommand } from "@shared/ingest/prepare";
import { withRequestState } from "@shared/request-state";
import { mirror as telemetryMirror } from "@shared/telemetry";

import { applyEnrichmentPatch } from "./enrichment-patch";
import { collectIngestEffects } from "./ingest-effects";
import { commitPreparedIngest } from "./ingest-handlers";
import { enrichCommand, followUpEnrichment, type EnrichmentFollowUp, type EnrichmentPatch } from "./listening-enrichment";
import { requestStore, type Env } from "./runtime";
import { prepareRecentlyPlayed } from "./stores/apple-music-store";

const NOW = 1_800_000_000_000;
const LINK = "https://music.apple.com/cn/album/x/1500?i=1501";
const env = {} as Env;

function inRequest<T>(run: () => Promise<T>): Promise<T> {
  return requestStore.run({ env, ctx: { waitUntil: () => {} } as unknown as ExecutionContext }, () => withRequestState(run));
}

function macEnvelope(title: string, at: number, upcoming: string[]) {
  const queue = upcoming.length
    ? { index: 0, tracks: [title, ...upcoming].map((name) => ({ title: name, artist: "Artist", album: null })) }
    : undefined;
  return {
    version: 4, presence: "online", heartbeatAt: at, activeModules: ["appleMusic"],
    modules: { appleMusic: { state: "playing", title, artist: "Artist", observedAt: at, queue } },
  };
}

async function prepareMac(title: string, at: number, upcoming: string[] = []): Promise<CoreCommand> {
  return inRequest(() => prepareIngest("mac", macEnvelope(title, at, upcoming), at, { head: async () => ({}) }) as Promise<CoreCommand>);
}

function seedUpcoming(kv: MemoryKv, title: string, songId: string) {
  kv.values.set(`lyjwpage:${trackLookupCacheKey({ title, artist: "Artist", album: null })}`,
    JSON.stringify({ link: LINK, artwork: null, id: "1500", songId, hasLyrics: false }));
}

async function retried(followUp: EnrichmentFollowUp): Promise<EnrichmentPatch | null> {
  let committed: EnrichmentPatch | null = null;
  await inRequest(() => followUpEnrichment(followUp, async (patch) => { committed = patch; }));
  return committed;
}

function seedFirst(kv: MemoryKv) {
  kv.values.set(`lyjwpage:${trackLookupCacheKey({ title: "First", artist: "Artist", album: null })}`,
    JSON.stringify({ link: LINK, artwork: null, id: "1500", songId: "1501", hasLyrics: false }));
  kv.values.set(`lyjwpage:${motionArtworkCacheKey(parseAppleMusicUrl(LINK)!)}`,
    JSON.stringify({ hasMotion: true, videoUrl: "https://mvod/x.m3u8", colors: null }));
}

function isolated(t: { after: (fn: () => void) => void }): MemoryKv {
  installStorageForTests(new FakeStorage());
  const kv = new MemoryKv();
  installAppleCacheForTests(kv);
  const originalFetch = globalThis.fetch;
  const originalWarn = console.warn;
  globalThis.fetch = (async () => { throw new Error("network disabled"); }) as typeof fetch;
  console.warn = () => {};
  t.after(() => {
    globalThis.fetch = originalFetch;
    console.warn = originalWarn;
    installAppleCacheForTests(null);
    resetStorageForTests();
  });
  return kv;
}

test("写入时目录查询失败：回执后重查成功，补丁按 trackKey 写回并推送", async (t) => {
  const kv = isolated(t);
  const { command, followUp } = await inRequest(async () => enrichCommand(await prepareMac("First", NOW)));
  assert.equal(followUp?.outcome.catalogKnown, false);
  await inRequest(() => collectIngestEffects(() => commitPreparedIngest(command)));
  assert.equal((await inRequest(() => telemetryMirror.get()))?.musicEnrichment?.songId, null);

  seedFirst(kv);
  const patch = await retried(followUp!);
  assert.equal(patch?.enrichment.songId, "1501");
  const before = await inRequest(() => telemetryMirror.get());
  const applied = await inRequest(() => collectIngestEffects(() => applyEnrichmentPatch(patch!)));
  assert.deepEqual([applied.ok, applied.ok && applied.value], [true, true]);
  assert.deepEqual(applied.effects.map((effect) => effect.kind), ["listening"]);
  const after = await inRequest(() => telemetryMirror.get());
  assert.equal(after?.musicEnrichment?.songId, "1501");
  assert.deepEqual(after?.musicEnrichment?.motion, { videoUrl: "https://mvod/x.m3u8", colors: null });
  assert.equal(after?.telemetryReceivedAt, before?.telemetryReceivedAt);
  assert.equal(after?.activityReceivedAt, before?.activityReceivedAt);

  const again = await inRequest(() => collectIngestEffects(() => applyEnrichmentPatch(patch!)));
  assert.deepEqual([again.ok && again.value, again.effects.length], [false, 0]);
});

test("补丁到达前曲目已换：丢弃，不写不推", async (t) => {
  const kv = isolated(t);
  const { command, followUp } = await inRequest(async () => enrichCommand(await prepareMac("First", NOW)));
  await inRequest(() => collectIngestEffects(() => commitPreparedIngest(command)));
  const { command: next } = await inRequest(async () => enrichCommand(await prepareMac("Second", NOW + 1_000)));
  await inRequest(() => collectIngestEffects(() => commitPreparedIngest(next)));

  seedFirst(kv);
  const patch = await retried(followUp!);
  assert.ok(patch);
  const result = await inRequest(() => collectIngestEffects(() => applyEnrichmentPatch(patch)));
  assert.deepEqual([result.ok && result.value, result.effects.length], [false, 0]);
  const stored = await inRequest(() => telemetryMirror.get());
  assert.equal(stored?.music?.title, "Second");
  assert.notEqual(stored?.musicEnrichment?.trackKey, patch.enrichment.trackKey);
  assert.equal(stored?.musicEnrichment?.songId, null);
});

test("同一首歌期间队列已更新：迟到的补丁补上目录，不带回旧队列的歌曲 ID", async (t) => {
  const kv = isolated(t);
  const { command, followUp } = await inRequest(async () => enrichCommand(await prepareMac("First", NOW, ["Old Next"])));
  await inRequest(() => collectIngestEffects(() => commitPreparedIngest(command)));
  seedUpcoming(kv, "New Next", "2002");
  const { command: requeued } = await inRequest(async () => enrichCommand(await prepareMac("First", NOW + 1_000, ["New Next"])));
  await inRequest(() => collectIngestEffects(() => commitPreparedIngest(requeued)));
  assert.deepEqual((await inRequest(() => telemetryMirror.get()))?.musicEnrichment?.upcomingSongIds, ["2002"]);

  seedFirst(kv);
  seedUpcoming(kv, "Old Next", "1001");
  const patch = await retried(followUp!);
  assert.deepEqual(patch?.enrichment.upcomingSongIds, ["1001"]);
  const applied = await inRequest(() => collectIngestEffects(() => applyEnrichmentPatch(patch!)));
  assert.equal(applied.ok && applied.value, true);
  const stored = await inRequest(() => telemetryMirror.get());
  assert.deepEqual(stored?.upcomingTracks?.map((track) => track.title), ["New Next"]);
  assert.equal(stored?.musicEnrichment?.songId, "1501");
  assert.deepEqual(stored?.musicEnrichment?.motion, { videoUrl: "https://mvod/x.m3u8", colors: null });
  assert.deepEqual(stored?.musicEnrichment?.upcomingSongIds, ["2002"]);
});

test("只有队列查询失败：回执后重查，补丁只补队列歌曲 ID", async (t) => {
  const kv = isolated(t);
  seedFirst(kv);
  const { command, followUp } = await inRequest(async () => enrichCommand(await prepareMac("First", NOW, ["Next"])));
  assert.deepEqual(
    [followUp?.outcome.catalogKnown, followUp?.outcome.motionKnown, followUp?.outcome.upcomingKnown],
    [true, true, false],
  );
  await inRequest(() => collectIngestEffects(() => commitPreparedIngest(command)));
  const before = await inRequest(() => telemetryMirror.get());
  assert.deepEqual(before?.musicEnrichment?.upcomingSongIds, []);

  seedUpcoming(kv, "Next", "1502");
  const patch = await retried(followUp!);
  assert.deepEqual(patch?.enrichment.upcomingSongIds, ["1502"]);
  const applied = await inRequest(() => collectIngestEffects(() => applyEnrichmentPatch(patch!)));
  assert.deepEqual([applied.ok && applied.value, applied.effects.map((effect) => effect.kind)], [true, ["listening"]]);
  const after = await inRequest(() => telemetryMirror.get());
  assert.deepEqual(after?.musicEnrichment, { ...before?.musicEnrichment, upcomingSongIds: ["1502"] });
  assert.equal(after?.activityReceivedAt, before?.activityReceivedAt);
});

test("HomePod 补丁同样按 trackKey 校验", async (t) => {
  isolated(t);
  const music = { source: "homepod" as const, state: "playing" as const, title: "First", artist: "Artist", album: null,
    trackId: null, artworkUrl: null, positionMs: 0, durationMs: 180_000, repeatOne: false, observedAt: NOW };
  await inRequest(() => homePodMirror.put({ music, receivedAt: NOW, enrichment: null }));
  const enrichment = {
    trackKey: trackKeyOf(music), id: "1500", link: LINK, songId: "1501", artwork: null,
    hasLyrics: false, upcomingSongIds: [], motion: null,
  };
  const stale: EnrichmentPatch = { target: "homepod", enrichment: { ...enrichment, trackKey: trackKeyOf({ ...music, title: "Other" }) }, upcomingKey: upcomingKeyOf([]) };
  const dropped = await inRequest(() => collectIngestEffects(() => applyEnrichmentPatch(stale)));
  assert.deepEqual([dropped.ok && dropped.value, dropped.effects.length], [false, 0]);
  assert.equal((await inRequest(() => homePodMirror.get()))?.enrichment, null);
  const applied = await inRequest(() => collectIngestEffects(() => applyEnrichmentPatch({ target: "homepod", enrichment, upcomingKey: upcomingKeyOf([]) })));
  assert.deepEqual([applied.ok && applied.value, applied.effects.map((effect) => effect.kind)], [true, ["listening"]]);
  const stored = await inRequest(() => homePodMirror.get());
  assert.equal(stored?.enrichment?.songId, "1501");
  assert.equal(stored?.receivedAt, NOW);
});

test("最近播放首项动态封面查询失败时沿用已存的，不算列表变化", async (t) => {
  isolated(t);
  const item: ListeningItem = {
    id: "1501", title: "First", artist: "Artist", artworkUrl: null, link: LINK, palette: [], durationMs: null,
    motion: { videoUrl: "https://mvod/x.m3u8", colors: null },
  };
  await inRequest(() => recentMirror.put({ items: [item], fetchedAt: NOW }));
  const unknown = await inRequest(() => prepareRecentlyPlayed([{ ...item, motion: undefined }], NOW + 1));
  assert.equal(unknown.changed, false);
  assert.deepEqual(unknown.listening.items[0]?.motion, item.motion);
  const gone = await inRequest(() => prepareRecentlyPlayed([{ ...item, motion: null }], NOW + 1));
  assert.equal(gone.changed, true);
});
