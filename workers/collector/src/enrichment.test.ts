import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import { trackLookupCacheKey } from "@shared/apple-music";
import { motionArtworkCacheKey } from "@shared/motion-artwork";
import { parseAppleMusicUrl } from "@shared/motion-artwork-url";
import type { EnrichmentFollowUp, EnrichmentPatch } from "@shared/track-enrichment";
import type { LocalNowPlaying } from "@shared/types";

import { enrichTrack, followUpTrack } from "./enrichment";
import type { Env } from "./env";
import { installCollectorPorts } from "./ports";
import { bindEnv, unbindEnvForTests } from "./runtime";
import { MemoryKv } from "./testing/memory-kv";

installCollectorPorts();

const LINK = "https://music.apple.com/cn/album/x/1500?i=1501";
const MOTION = { videoUrl: "https://mvod/x.m3u8", colors: null };
const music: LocalNowPlaying = {
  source: "apple-music", state: "playing", title: "First", artist: "Artist", album: null,
  trackId: null, artworkUrl: null, positionMs: 0, durationMs: 180_000, repeatOne: false, observedAt: 1,
};

const originalFetch = globalThis.fetch;
const originalWarn = console.warn;
let kv: MemoryKv;

beforeEach(() => {
  kv = new MemoryKv();
  globalThis.fetch = (async () => { throw new Error("network disabled"); }) as typeof fetch;
  console.warn = () => {};
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  console.warn = originalWarn;
  unbindEnvForTests();
});

async function seedFirst(): Promise<void> {
  await kv.put(`lyjwpage:${trackLookupCacheKey(music)}`, JSON.stringify({ link: LINK, artwork: null, id: "1500", songId: "1501", hasLyrics: false }));
  await kv.put(`lyjwpage:${motionArtworkCacheKey(parseAppleMusicUrl(LINK)!)}`, JSON.stringify({ hasMotion: true, ...MOTION }));
}

function envWith(patches: EnrichmentPatch[], commit = async (patch: EnrichmentPatch) => { patches.push(patch); return { applied: true }; }): Env {
  return bindEnv({ APPLE_CACHE: kv.asKv(), CORE: { commitEnrichmentPatch: commit } } as unknown as Env);
}

test("enrichTrack reads the catalog and motion artwork through APPLE_CACHE and marks every stage known", async () => {
  envWith([]);
  await seedFirst();
  const outcome = await enrichTrack(music, []);
  assert.deepEqual(
    [outcome?.enrichment.songId, outcome?.enrichment.motion, outcome?.catalogKnown, outcome?.motionKnown, outcome?.upcomingKnown],
    ["1501", MOTION, true, true, true],
  );
  assert.equal(await enrichTrack(null, []), null);
  assert.equal(await enrichTrack({ ...music, state: "stopped" }, []), null);
});

test("a stage that failed at write time is retried in the follow-up and the better result goes to the core", async () => {
  const patches: EnrichmentPatch[] = [];
  const env = envWith(patches);
  const outcome = await enrichTrack(music, []);
  assert.equal(outcome?.catalogKnown, false);

  await seedFirst();
  const followUp: EnrichmentFollowUp = { target: "mac", music, upcomingTracks: [], outcome: outcome! };
  await followUpTrack(env, followUp);
  assert.deepEqual(patches.map((patch) => [patch.target, patch.enrichment.songId, patch.enrichment.motion]), [["mac", "1501", MOTION]]);
});

test("a follow-up whose patch the core rejects only logs, so the caller's waitUntil never fails", async () => {
  const env = envWith([], async () => { throw new Error("core unavailable"); });
  const outcome = await enrichTrack(music, []);
  await seedFirst();
  await assert.doesNotReject(followUpTrack(env, { target: "homepod", music, upcomingTracks: [], outcome: outcome! }));
});
