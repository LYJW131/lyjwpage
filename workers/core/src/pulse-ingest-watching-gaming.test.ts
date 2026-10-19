import assert from "node:assert/strict";
import test from "node:test";

import { commitPreparedEmbyReport } from "@core/stores/emby";
import { commitPreparedPlaystationReport } from "@core/stores/playstation";
import { getPlaying, getPlayingNow } from "./playstation";
import { powerMirror } from "@shared/playstation-store";
import { prepareEmbyReport } from "@shared/ingest/emby";
import { preparePlaystationReport } from "@shared/ingest/playstation";
import { prepareQuestReport } from "@shared/ingest/quest";
import { commitPreparedQuestReport } from "@core/stores/quest";
import { T0, closed, inRequest, open, withStorage } from "./testing/pulse-ingest-harness";

const recordEmbyReport = async (input: unknown, at: number) => commitPreparedEmbyReport(await prepareEmbyReport(input, at, { head: async () => null }));
const recordPlaystationReport = (input: unknown, at: number) => commitPreparedPlaystationReport(preparePlaystationReport(input, at));

test("Emby：位置更新沿用存着的标题，itemId 对不上不借标题，明确停播后一直是空闲", withStorage(async (storage) => {
  await inRequest(() => recordEmbyReport({ playing: {
    itemId: "42", paused: false, positionTicks: 0, runTimeTicks: 36_000_000_000,
    item: { id: "42", name: "Frieren", type: "Series" },
  } }, T0));
  const paused = T0 + 30_000;
  await inRequest(() => recordEmbyReport({ playing: { itemId: "42", paused: true, positionTicks: 1, runTimeTicks: 36_000_000_000 } }, paused));
  assert.deepEqual(await closed(storage, "watching"), [{ state: "playing", itemId: "42", title: "Frieren", subtitle: null, from: T0, to: paused }]);
  assert.equal((await open(storage, "watching")).title, "Frieren");

  const other = paused + 30_000;
  await inRequest(() => recordEmbyReport({ playing: { itemId: "77", paused: false, positionTicks: 0, runTimeTicks: 36_000_000_000 } }, other));
  assert.deepEqual(await open(storage, "watching"), { state: "playing", itemId: "77", title: null, subtitle: null, from: other, seenAt: other, holdUntil: other + 10 * 60_000, endsBy: null });

  const stop = other + 60_000;
  await inRequest(() => recordEmbyReport({ playing: null }, stop));
  assert.equal((await open(storage, "watching")).state, "idle");
  const resume = stop + 5 * 3_600_000;
  await inRequest(() => recordEmbyReport({ playing: { itemId: "42", paused: false, positionTicks: 2, runTimeTicks: 36_000_000_000 } }, resume));
  assert.deepEqual((await closed(storage, "watching")).at(-1), { state: "idle", itemId: null, title: null, subtitle: null, from: stop, to: resume });
}));

test("PSN 在线状态：进游戏、换游戏、下线各是一段", withStorage(async (storage) => {
  const presence = (at: number, online: boolean, playing: { titleId: string; title: string } | null) =>
    ({ version: 1, presence: { observedAt: at, online, availability: null, platform: "PS5", lastOnlineAt: null,
      playing: playing && { ...playing, format: null, launchPlatform: null, iconUrl: null } } });
  await inRequest(() => recordPlaystationReport(presence(T0, true, null), T0));
  await powerMirror.put({ on: true, observedAt: T0, entityId: "switch.ps5_210_power" });
  assert.equal("power" in await getPlayingNow(), false, "保留的内部镜像不进入公开 presence");
  const game = T0 + 20 * 60_000;
  await inRequest(() => recordPlaystationReport(presence(game, true, { titleId: "PPSA01", title: "Pragmata" }), game));
  await inRequest(() => recordPlaystationReport(presence(game + 34 * 60_000, true, { titleId: "PPSA01", title: "Pragmata" }), game + 34 * 60_000));
  const off = game + 50 * 60_000;
  await inRequest(() => recordPlaystationReport(presence(off, false, null), off));
  assert.deepEqual((await closed(storage, "gaming")).map((row) => [row.state, row.title, row.from, row.to]), [
    ["online", null, T0, game],
    ["in-game", "Pragmata", game, off],
  ]);
  assert.equal((await open(storage, "gaming")).state, "offline");
}));

test("迟到的更旧 PlayStation 快照不倒灌在线状态、游玩列表和游戏道", withStorage(async (storage) => {
  const presence = (at: number, online: boolean, playing: { titleId: string; title: string } | null) =>
    ({ version: 1, presence: { observedAt: at, online, availability: null, platform: "PS5", lastOnlineAt: null,
      playing: playing && { ...playing, format: null, launchPlatform: null, iconUrl: null } } });
  const game = (at: number, name: string) => ({
    version: 1,
    playedGames: {
      observedAt: at,
      items: [{
        titleId: "PPSA01", name, category: "ps5_native_game", playCount: 1,
        firstPlayedAt: at, lastPlayedAt: at, playDurationMs: 1_000, imageUrl: null, service: null, preOrder: false,
      }],
    },
  });
  const off = T0 + 60 * 60_000;
  await inRequest(() => recordPlaystationReport(presence(off, false, null), off));
  await inRequest(() => recordPlaystationReport(game(off, "Pragmata"), off));
  const late = off + 10 * 60_000;
  await inRequest(() => recordPlaystationReport(presence(T0, true, { titleId: "PPSA01", title: "Old session" }), late));
  await inRequest(() => recordPlaystationReport(game(T0, "Old name"), late));
  const now = await getPlayingNow();
  assert.equal(now.observedAt, off);
  assert.equal(now.online, false);
  assert.equal(now.playing, null);
  assert.equal((await getPlaying()).items[0]?.name, "Pragmata");
  assert.equal((await open(storage, "gaming")).state, "offline");
  assert.equal((await closed(storage, "gaming")).some((row) => row.state === "in-game"), false);
}));

test("游戏道合并 PlayStation 与 Quest：Quest 在玩时 PS 的在线截不断它，停玩后交还 PS", withStorage(async (storage) => {
  const ps = (at: number) => recordPlaystationReport({ version: 1, presence: { observedAt: at, online: true, availability: null, platform: "PS5", lastOnlineAt: null, playing: null } }, at);
  const quest = (at: number, playing: unknown) => commitPreparedQuestReport(prepareQuestReport({ version: 1, presence: { observedAt: at, discordStatus: "online", playing } }, at));
  const beatSaber = { name: "Beat Saber", platform: "meta_quest", applicationId: "123", startedAt: null };
  await inRequest(() => ps(T0));
  const start = T0 + 10 * 60_000;
  await inRequest(() => quest(start, beatSaber));
  await inRequest(() => ps(start + 2 * 60_000));
  assert.deepEqual(await open(storage, "gaming"), { ...(await open(storage, "gaming")), state: "in-game", titleId: "quest:123", title: "Beat Saber", from: start });
  const stop = start + 30 * 60_000;
  await inRequest(() => quest(stop, null));
  assert.deepEqual((await closed(storage, "gaming")).map((row) => [row.state, row.titleId, row.title, row.from, row.to]), [
    ["online", null, null, T0, start],
    ["in-game", "quest:123", "Beat Saber", start, stop],
  ]);
  assert.equal((await open(storage, "gaming")).state, "online");
  await inRequest(() => quest(stop + 60_000, null));
  assert.equal((await closed(storage, "gaming")).length, 2, "Quest 一直没在玩时不写游戏道");
}));
