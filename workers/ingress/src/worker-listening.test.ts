import assert from "node:assert/strict";
import test from "node:test";

import type { EnrichmentOutcome } from "@shared/track-enrichment";

import { mac, post, world } from "./testing/world";

function outcomeFor(title: string): EnrichmentOutcome {
  return {
    enrichment: { trackKey: title, id: "1500", link: "https://music.apple.com/cn/album/x/1500?i=1501", songId: "1501", artwork: null, hasLyrics: true, upcomingSongIds: [], motion: null },
    catalogKnown: true,
    upcomingKnown: true,
    motionKnown: false,
  };
}

test("listening: the collector enriches before the commit and takes the follow-up after the receipt", async () => {
  const w = world({ enrichTrack: async (music) => outcomeFor(music?.title ?? "") });
  const queue = { index: 0, tracks: [{ title: "Song" }, { title: "Next" }] };
  const response = await w.send("/api/ingest/mac", post(mac({ appleMusic: { state: "playing", title: "Song", queue } })));
  assert.equal(response.status, 202);
  const [command] = w.calls.commits;
  assert.ok(command?.source === "mac" && command.modules.appleMusic);
  const { music, upcomingTracks, enrichment } = command.modules.appleMusic;
  assert.equal(music?.title, "Song");
  assert.deepEqual(w.calls.enriched, [[music, upcomingTracks]]);
  assert.deepEqual(upcomingTracks.map((track) => track.title), ["Next"]);
  assert.deepEqual(enrichment, outcomeFor("Song").enrichment);
  assert.deepEqual(w.calls.followUps, [{ target: "mac", music, upcomingTracks, outcome: outcomeFor("Song") }]);

  const homepod = await w.send("/api/ingest/homepod", post({ state: "playing", title: "Pod", artist: "Artist", entityId: "media_player.homepod" }));
  assert.equal(homepod.status, 202);
  const pod = w.calls.commits[1];
  assert.ok(pod?.source === "homepod");
  assert.deepEqual(pod.stored.enrichment, outcomeFor("Pod").enrichment);
  assert.deepEqual(w.calls.followUps[1], { target: "homepod", music: pod.stored.music, upcomingTracks: [], outcome: outcomeFor("Pod") });
});

test("listening: nothing to enrich commits enrichment null; a rejected commit gets no follow-up", async () => {
  const stopped = world();
  assert.equal((await stopped.send("/api/ingest/homepod", post({ state: "idle", entityId: "media_player.homepod" }))).status, 202);
  const [command] = stopped.calls.commits;
  assert.equal(command?.source === "homepod" ? command.stored.enrichment : undefined, null);
  assert.deepEqual(stopped.calls.followUps, []);

  const rejected = world({ enrichTrack: async (music) => outcomeFor(music?.title ?? ""), reply: () => ({ ready: true, ok: false, error: "bad" }) });
  assert.equal((await rejected.send("/api/ingest/homepod", post({ state: "playing", title: "Pod", entityId: "media_player.homepod" }))).status, 400);
  assert.equal(rejected.calls.enriched.length, 1);
  assert.deepEqual(rejected.calls.followUps, []);
});

test("listening: an unreachable collector leaves the command unenriched for the state core, and the report still lands", async (t) => {
  const warned = t.mock.method(console, "warn", () => {});
  const broken = world({ enrichTrack: async () => { throw new Error("Network connection lost."); } });
  assert.equal((await broken.send("/api/ingest/homepod", post({ state: "playing", title: "Pod", entityId: "media_player.homepod" }))).status, 202);
  const [command] = broken.calls.commits;
  assert.ok(command?.source === "homepod");
  assert.equal("enrichment" in command.stored, false);
  assert.deepEqual(broken.calls.followUps, []);
  assert.deepEqual(warned.mock.calls.map((call) => call.arguments), [["[enrichment]", "homepod", "Network connection lost."]]);

  const unbound = world({ collector: false });
  assert.equal((await unbound.send("/api/ingest/mac", post(mac({ appleMusic: { state: "playing", title: "Song" } })))).status, 202);
  const [mac0] = unbound.calls.commits;
  assert.ok(mac0?.source === "mac" && mac0.modules.appleMusic);
  assert.equal("enrichment" in mac0.modules.appleMusic, false);
});
