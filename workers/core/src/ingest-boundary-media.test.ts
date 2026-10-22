import assert from "node:assert/strict";
import test from "node:test";

import { getImageObjectKeys } from "./emby-store";
import { getPlaystationTrophies } from "./playstation-store";
import { FakeStorage, installTestStorage } from "@shared/testing/fake-storage";
import { mirror as telemetryMirror } from "@shared/telemetry";

import { dispatchIngestEffects, type CollectedIngest } from "./ingest-effects";
import { prepareIngest as prepareShared, type CoreCommand } from "@shared/ingest/prepare";
import { resetStoredImageCacheForTests, type ImageBucket } from "@shared/ingest/r2-assets";
import { trackKeyOf } from "@shared/track-enrichment";
import { type Env } from "./runtime";
import { HASH_A, HASH_B, NOW, commit, envelope, inRequest, testEnv } from "./testing/ingest-harness";

function prepareIngest(source: string, body: unknown, at: number, images: ImageBucket = { head: async () => ({}) }): Promise<CoreCommand> {
  return prepareShared(source, body, at, images) as Promise<CoreCommand>;
}

test("Emby R2 HEAD runs during ingress preparation and does not block another source commit", async () => {
  const storage = new FakeStorage();
  installTestStorage(storage);
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => { release = resolve; });
  let heads = 0;
  const env = testEnv();
  try {
    const emby = prepareIngest("emby", {
      images: [{ imageKey: "item:poster", objectKey: `${HASH_A}.webp` }],
    }, NOW, { head: async () => { heads += 1; await blocked; return {}; } });
    await Promise.resolve();
    assert.equal(heads, 1);

    const phone = await prepareIngest("iphone", { version: 1 }, NOW);
    const phoneResult = await commit(env, phone);
    assert.equal(phoneResult.ok, true);
    release();
    const preparedEmby = await emby as Extract<CoreCommand, { source: "emby" }>;
    assert.deepEqual(preparedEmby.images, [{ key: "item:poster", objectKey: `${HASH_A}.webp` }]);

    resetStoredImageCacheForTests();
    const embyResult = await commit(env, preparedEmby);
    assert.equal(embyResult.ok, true);
    assert.deepEqual(await getImageObjectKeys(), { "item:poster": `${HASH_A}.webp` });
  } finally { release(); installTestStorage(null); }
});

test("Emby image commits merge against the latest map without losing concurrent keys", async () => {
  const storage = new FakeStorage();
  installTestStorage(storage);
  const env = testEnv();
  try {
    const [first, second] = await Promise.all([
      prepareIngest("emby", { images: [{ imageKey: "a", objectKey: `${HASH_A}.webp` }] }, NOW),
      prepareIngest("emby", { images: [{ imageKey: "b", objectKey: `${HASH_B}.webp` }] }, NOW + 1),
    ]);
    assert.equal((await commit(env, first)).ok, true);
    assert.equal((await commit(env, second)).ok, true);
    assert.deepEqual(await getImageObjectKeys(), { a: `${HASH_A}.webp`, b: `${HASH_B}.webp` });
  } finally { installTestStorage(null); }
});

test("desktop icon commits merge the latest map without losing another report", async () => {
  const storage = new FakeStorage();
  installTestStorage(storage);
  const env = testEnv();
  try {
    const make = (name: string, iconHash: string, objectKey: string, at: number) =>
      inRequest(env, () => prepareIngest("mac", envelope({ desktop: {
        applicationName: name,
        iconHash,
        iconObjectKey: objectKey,
        observedAt: at,
      } }, ["desktop"]), at));
    const first = await make("First", HASH_A, `${HASH_A}.webp`, NOW);
    const second = await make("Second", HASH_B, `${HASH_B}.webp`, NOW + 1);
    assert.equal((await commit(env, first)).ok, true);
    assert.equal((await commit(env, second)).ok, true);
    assert.deepEqual((await telemetryMirror.get())?.desktopIconAssets, [
      [HASH_A, `${HASH_A}.webp`],
      [HASH_B, `${HASH_B}.webp`],
    ]);
  } finally { installTestStorage(null); }
});

function trophiesReport(observedAt: number, earned: boolean) {
  const counts = (bronze: number) => ({ platinum: 0, gold: 0, silver: 0, bronze });
  return {
    observedAt,
    profile: {
      onlineId: "tester", avatarUrl: null, plus: false, level: 1, tier: 1,
      trophyPoint: 0, levelBasePoint: 0, levelNextPoint: 60, levelProgress: 0,
      earned: counts(earned ? 1 : 0),
    },
    titles: [{
      npCommunicationId: "NPWR00001_00", name: "Game", localizedName: null,
      titleIds: ["PPSA00001_00"], iconUrl: null, platform: "PS5",
      progress: earned ? 100 : 0, defined: counts(1), earned: counts(earned ? 1 : 0),
      lastUpdatedAt: earned ? observedAt : null, playDurationMs: null, playCount: 1,
      firstPlayedAt: null, lastPlayedAt: null, service: null, preOrder: false,
      groups: [{
        id: "default", name: "Game", iconUrl: null, progress: earned ? 100 : 0,
        defined: counts(1), earned: counts(earned ? 1 : 0),
      }],
      trophies: [{
        id: 0, type: "bronze", name: "First", detail: null, iconUrl: null, hidden: false,
        groupId: "default", earned, earnedAt: earned ? observedAt : null, earnedRate: 50,
      }],
    }],
  };
}

test("PlayStation trophies push the summary only when the catalog content changes", async () => {
  installTestStorage(new FakeStorage());
  const env = testEnv();
  const ingest = async (observedAt: number, earned: boolean) => commit(env, await inRequest(env, () =>
    prepareIngest("playstation", { version: 1, trophies: trophiesReport(observedAt, earned) }, observedAt)));
  const pushed = (result: CollectedIngest<unknown>) => result.effects.flatMap((effect) =>
    effect.kind === "event" && effect.event.type === "trophies" ? [effect.event.payload] : []);
  try {
    assert.equal(pushed(await ingest(NOW, false)).length, 1);
    assert.deepEqual(pushed(await ingest(NOW + 60_000, false)), []);

    const [summary] = pushed(await ingest(NOW + 120_000, true));
    assert.ok(summary);
    assert.equal(Object.hasOwn(summary.titles[0]!, "trophies"), false);
    assert.deepEqual(summary.earned, { platinum: 0, gold: 0, silver: 0, bronze: 1 });
    assert.equal(summary.recent[0]?.trophyName, "First");
  } finally { installTestStorage(null); }
});

test("PlayStation trophies stored with a future observedAt do not veto later honest reports", async () => {
  installTestStorage(new FakeStorage());
  const env = testEnv();
  const poisoned = NOW + 10 * 365 * 86_400_000;
  const ingest = async (observedAt: number, receivedAt: number, earned: boolean) => commit(env, await inRequest(env, () =>
    prepareIngest("playstation", { version: 1, trophies: trophiesReport(observedAt, earned) }, receivedAt)));
  try {
    assert.equal((await ingest(poisoned, poisoned, false)).ok, true);
    assert.equal((await ingest(NOW, NOW, true)).ok, true);
    const stored = await inRequest(env, () => getPlaystationTrophies());
    assert.equal(stored?.observedAt, NOW);
    assert.equal(stored?.profile.earned.bronze, 1);
  } finally { installTestStorage(null); }
});

test("PlayStation ingest refuses an observedAt ahead of the receive time", async () => {
  installTestStorage(new FakeStorage());
  const env = testEnv();
  try {
    await assert.rejects(inRequest(env, () =>
      prepareIngest("playstation", { version: 1, trophies: trophiesReport(NOW + 3_600_000, false) }, NOW)), /observedAt/);
  } finally { installTestStorage(null); }
});

test("listening effects retain the track from their own commit", async () => {
  const storage = new FakeStorage();
  installTestStorage(storage);
  const env = testEnv();
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = (async () => {
    fetches += 1;
    throw new Error("network called during commit");
  }) as typeof fetch;
  try {
    const make = (title: string, at: number) => inRequest(env, () => prepareIngest("mac", envelope({
      appleMusic: { state: "playing", title, artist: "Artist", observedAt: at },
    }, ["appleMusic"]), at));
    const first = await make("First", NOW);
    const second = await make("Second", NOW + 1);
    const firstResult = await commit(env, first);
    const secondResult = await commit(env, second);
    assert.equal(firstResult.ok, true);
    assert.equal(secondResult.ok, true);
    const title = (result: CollectedIngest<unknown>) => result.effects.find(
      (effect) => effect.kind === "listening",
    )?.kind === "listening"
      ? result.effects.find((effect) => effect.kind === "listening")!.mac?.music?.title
      : null;
    assert.equal(title(firstResult), "First");
    assert.equal(title(secondResult), "Second");
    assert.equal(fetches, 0);
    let broadcasts = 0;
    const dispatchEnv = {
      ...env,
      LIVE_PUSH: {
        idFromName: () => null,
        get: () => ({ broadcast: async () => { broadcasts += 1; } }),
      },
    } as unknown as Env;
    await inRequest(dispatchEnv, () => dispatchIngestEffects(firstResult.effects));
    assert.equal(broadcasts, 1);
  } finally {
    globalThis.fetch = originalFetch;
    installTestStorage(null);
  }
});

test("enrichment carried by the command is stored with the track and the push reads it without network", async () => {
  const storage = new FakeStorage();
  installTestStorage(storage);
  const env = testEnv();
  const originalFetch = globalThis.fetch;
  let fetches = 0;
  globalThis.fetch = (async () => {
    fetches += 1;
    throw new Error("network disabled");
  }) as typeof fetch;
  try {
    const prepared = await inRequest(env, () => prepareIngest("mac", envelope({
      appleMusic: { state: "playing", title: "First", artist: "Artist", observedAt: NOW },
    }, ["appleMusic"]), NOW));
    assert.ok(prepared.source === "mac" && prepared.modules.appleMusic);
    const enrichment = {
      trackKey: trackKeyOf({ title: "First", artist: "Artist", album: null }), id: "1500",
      link: "https://music.apple.com/cn/album/x/1500?i=1501", songId: "1501", artwork: null,
      hasLyrics: false, upcomingSongIds: [], motion: { videoUrl: "https://mvod/x.m3u8", colors: null },
    };
    const result = await commit(env, {
      ...prepared,
      modules: { ...prepared.modules, appleMusic: { ...prepared.modules.appleMusic, enrichment } },
    });
    assert.equal(result.ok, true);
    const stored = await inRequest(env, () => telemetryMirror.get());
    assert.equal(stored?.musicEnrichment?.songId, "1501");
    const messages: string[] = [];
    const dispatchEnv = {
      ...env,
      LIVE_PUSH: { idFromName: () => null, get: () => ({ broadcast: async (message: string) => { messages.push(message); } }) },
    } as unknown as Env;
    await inRequest(dispatchEnv, () => dispatchIngestEffects(result.effects));
    const event = JSON.parse(messages[0]!) as { type: string; payload: { songId: string; motion: unknown } };
    assert.equal(event.type, "listening-now");
    assert.equal(event.payload.songId, "1501");
    assert.deepEqual(event.payload.motion, { videoUrl: "https://mvod/x.m3u8", colors: null });
    assert.equal(fetches, 0);
  } finally {
    globalThis.fetch = originalFetch;
    installTestStorage(null);
  }
});
