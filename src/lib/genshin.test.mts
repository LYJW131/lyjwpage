import assert from "node:assert/strict";
import test from "node:test";

import { statusEnvelope } from "@/lib/api";
import { abyssLabel, mapGenshinPlayerInfo } from "@/lib/genshin";
import { installLagStoreForTests } from "@/lib/lag-store";
import { loadEndpoint } from "@/lib/status-loaders";
import { STATUS_VIEWS } from "@/lib/status-views";
import { LAG_KEYS, type LagEntry } from "@shared/lag";

const profile = {
  nickname: "LYJW",
  adventureRank: 60,
  worldLevel: 9,
  achievements: 1234,
  abyss: { floor: 12, chamber: 3 },
  theaterAct: null,
};

test("the Enka mapper keeps only the public fields and treats omitted zero counts as 0", () => {
  assert.deepEqual(
    mapGenshinPlayerInfo({ playerInfo: { nickname: "Traveler", level: 5, signature: "hi", profilePicture: { id: 1 } }, uid: "123456789" }),
    { nickname: "Traveler", adventureRank: 5, worldLevel: 0, achievements: 0, abyss: null, theaterAct: null },
  );
  assert.throws(() => mapGenshinPlayerInfo({}), /playerInfo/);
  assert.throws(() => mapGenshinPlayerInfo({ playerInfo: { nickname: "x" } }), /malformed/);
  assert.equal(abyssLabel({ floor: 12, chamber: 3 }), "12-3");
  assert.equal(abyssLabel(null), "—");
});

test("/api/status/genshin is a lag view without a push event and serves the lag envelope or the awaiting shape", async (t) => {
  assert.equal(STATUS_VIEWS.genshin.layer, "lag");
  assert.equal("event" in STATUS_VIEWS.genshin, false);

  let entry: LagEntry<unknown> | null = null;
  installLagStoreForTests(async (key) => (key === LAG_KEYS.genshin ? entry : null));
  t.after(() => installLagStoreForTests(null));

  const empty = await statusEnvelope(() => loadEndpoint("genshin"));
  assert.deepEqual(empty, { ok: false, error: "Waiting for the first Genshin Impact profile" });

  entry = { updatedAt: 1_000, data: profile };
  const envelope = await statusEnvelope(() => loadEndpoint("genshin"));
  assert.equal(envelope.ok, true);
  assert.ok(envelope.ok);
  assert.deepEqual(envelope.data, profile);
  assert.equal(envelope.updatedAt, 1_000);
});
