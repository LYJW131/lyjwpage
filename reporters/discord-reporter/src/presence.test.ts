import assert from "node:assert/strict";
import test from "node:test";

import { describeActivities, largeImageUrlOf, pickPlaying, reportFrom } from "./presence.ts";

const quest = {
  name: "Beat Saber",
  type: 0,
  platform: "meta_quest",
  details: "In the world",
  state: null,
  timestamps: { start: 1_700_000_000_000 },
  application_id: "123",
  assets: { large_image: "cover" },
};

test("pickPlaying 只要 meta_quest 的 Playing", () => {
  const hit = pickPlaying({ status: "online", activities: [quest] });
  assert.equal(hit?.name, "Beat Saber");
  assert.equal(hit?.platform, "meta_quest");
  assert.equal(hit?.startedAt, 1_700_000_000_000);
  assert.equal(hit?.largeImageUrl, "https://cdn.discordapp.com/app-assets/123/cover.png?size=256");

  assert.equal(
    pickPlaying({
      status: "online",
      activities: [{ name: "Cursor", type: 0, platform: "desktop" }],
    }),
    null,
  );
  assert.equal(
    pickPlaying({
      status: "online",
      activities: [{ name: "Spotify", type: 2, platform: "desktop" }],
    }),
    null,
  );
});

test("Quest 封面走 media proxy", () => {
  const url = largeImageUrlOf({
    application_id: "1",
    assets: { large_image: "mp:external/abc/https/example.com/cover.png" },
  });
  assert.equal(url, "https://media.discordapp.net/external/abc/https/example.com/cover.png");
});

test("reportFrom 没 presence 就当 offline 没在玩", () => {
  const report = reportFrom(undefined, 10);
  assert.deepEqual(report, { profile: null, observedAt: 10, discordStatus: "offline", playing: null });
});

test("忽略比 Quest 更新的 PlayStation 活动", () => {
  const quest = {
    name: "Beat Saber",
    type: 0,
    platform: "meta_quest",
    timestamps: { start: 200 },
  };
  const older = {
    name: "MELTY BLOOD: TYPE LUMINA",
    type: 0,
    platform: "ps5",
    timestamps: { start: 300 },
  };
  assert.equal(pickPlaying({ activities: [quest, older] })?.name, "Beat Saber");
  assert.equal(pickPlaying({ activities: [older, quest] })?.name, "Beat Saber");
});

test("describeActivities 给日志用", () => {
  assert.equal(describeActivities({ activities: [] }), "无活动");
  assert.equal(describeActivities({ activities: [quest] }), "0:Beat Saber@meta_quest app=123");
});

test("PS4/PS5 and offline activities never appear", () => {
  for (const platform of ["ps4", "ps5", "desktop"]) {
    assert.equal(pickPlaying({ activities: [{ ...quest, platform }] }), null);
  }
  assert.equal(pickPlaying({ status: "offline", activities: [quest] }), null);
});
