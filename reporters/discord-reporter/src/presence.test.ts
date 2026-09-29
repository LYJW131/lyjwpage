import assert from "node:assert/strict";
import test from "node:test";
import { largeImageUrlOf, pickPlaying, reportFrom } from "./presence.ts";

const quest = {
  name: "Beat Saber", type: 0, platform: "meta_quest", details: "In the world", state: null,
  timestamps: { start: 1_700_000_000_000 }, application_id: "123", parent_application_id: "456",
  assets: { large_image: "cover" },
};

test("only raw meta_quest Playing is retained with original fields", () => {
  assert.deepEqual(pickPlaying({ status: "online", activities: [quest] }), {
    name: "Beat Saber", platform: "meta_quest", details: "In the world", state: null,
    startedAt: 1_700_000_000_000, applicationId: "123", parentApplicationId: "456",
    largeImageUrl: "https://cdn.discordapp.com/app-assets/123/cover.png?size=256",
  });
  for (const platform of ["ps4", "ps5", "desktop", undefined]) {
    assert.equal(pickPlaying({ activities: [{ ...quest, platform }] }), null);
  }
  assert.equal(pickPlaying({ activities: [{ ...quest, type: 2 }] }), null);
  assert.equal(pickPlaying({ status: "offline", activities: [quest] }), null);
});

test("most recent Quest activity wins regardless of other platform recency", () => {
  const older = { ...quest, name: "Old Quest", timestamps: { start: 200 } };
  const newer = { ...quest, name: "New Quest", timestamps: { start: 300 } };
  const ps5 = { ...quest, platform: "ps5", timestamps: { start: 400 } };
  assert.equal(pickPlaying({ activities: [newer, ps5, older] })?.name, "New Quest");
  assert.equal(pickPlaying({ activities: [{ ...quest, timestamps: null, created_at: 500 }, newer] })?.name, "Beat Saber");
});

test("cover URL only derives from raw assets", () => {
  assert.equal(largeImageUrlOf({ assets: { large_image: "mp:external/abc/https/example.com/cover.png" } }),
    "https://media.discordapp.net/external/abc/https/example.com/cover.png");
  assert.equal(largeImageUrlOf({ assets: { large_image: "spotify:track" } }), null);
  assert.equal(largeImageUrlOf({ application_id: "123" }), null);
});

test("unknown or incomplete presence is never fabricated as offline", () => {
  for (const presence of [undefined, null, {}, { status: "online" }, { status: "invalid", activities: [] }]) {
    assert.equal(reportFrom(presence, 10), null);
  }
  assert.deepEqual(reportFrom({ status: "offline" }, 10), { observedAt: 10, discordStatus: "offline", playing: null });
  assert.deepEqual(reportFrom({ status: "idle", activities: [] }, 10), { observedAt: 10, discordStatus: "idle", playing: null });
});
