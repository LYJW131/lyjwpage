import assert from "node:assert/strict";
import test from "node:test";

import type { NowWatchingPayload } from "@shared/emby";
import { PLAYSTATION_STALE_MS } from "@shared/freshness";
import { QUEST_STALE_MS, type QuestNow } from "@shared/quest";
import type {
  CodingNowPayload,
  LocalNowPlaying,
  NowListeningPayload,
  PlaystationPresencePayload,
} from "@shared/types";

import { CODING_ACTIVE_WINDOW_MS, pickLiveActivity, type LiveActivityInput } from "./live-activity";

const NOW = 1_800_000_000_000;
const POSTER_KEY = `${"a".repeat(64)}.png`;

function input(partial: Partial<LiveActivityInput> = {}): LiveActivityInput {
  return { nowListening: null, nowWatching: null, playingNow: null, questNow: null, codingNow: null, ...partial };
}

function music(partial: Partial<LocalNowPlaying> = {}): LocalNowPlaying {
  return {
    source: "apple-music", state: "playing", title: "Song", artist: "Artist", album: null,
    trackId: null, artworkUrl: null, positionMs: 0, durationMs: 200_000, repeatOne: false,
    observedAt: NOW, ...partial,
  };
}

function listening(partial: Partial<NowListeningPayload> = {}): NowListeningPayload {
  return {
    lastSeenAt: NOW, declaredOffline: false, heartbeatWindowMs: 300_000,
    music: null, receivedAt: NOW, idle: true, id: null, link: null, songId: null,
    upcomingSongIds: [], hasLyrics: false, motion: null, expiresInMs: null, alternate: null,
    elsewhere: null, ...partial,
  };
}

function watching(paused = false): NowWatchingPayload {
  return {
    nowPlaying: {
      itemId: "emby1", paused, progress: 12, client: "Emby Web", deviceName: "TV",
      playMethod: "directplay", media: null, positionMs: 600_000, durationMs: 4_800_000,
    },
    current: {
      id: "emby1", title: "Frieren", subtitle: "S1E3 · The Magician", progress: 12,
      poster: `/img/${POSTER_KEY}`, backdrop: null, type: "Episode", year: 2023, link: null,
      playedAt: new Date(NOW - 600_000).toISOString(),
    },
  };
}

function psPlaying(): PlaystationPresencePayload["playing"] {
  return {
    titleId: "PPSA02530_00", title: "PRAGMATA", format: "PS5", launchPlatform: "PS5",
    iconUrl: "https://image.api.playstation.com/vulcan/ap/rnd/icon.png",
  };
}

function playingNow(partial: Partial<PlaystationPresencePayload> = {}): PlaystationPresencePayload {
  return {
    observedAt: NOW, online: true, availability: "availableToPlay", platform: "PS5",
    lastOnlineAt: NOW, playing: null, ...partial,
  };
}

function questPlaying(): NonNullable<QuestNow["playing"]> {
  return {
    name: "Asgard's Wrath 2", platform: "meta_quest", details: null, state: null,
    startedAt: NOW - 600_000, applicationId: "123", parentApplicationId: null, largeImageUrl: null,
  };
}

function questNow(partial: Partial<QuestNow> = {}): QuestNow {
  return { available: true, observedAt: NOW, receivedAt: NOW, playing: null, ...partial };
}

function codingNow(partial: Partial<CodingNowPayload> = {}): CodingNowPayload {
  return {
    agents: [], lastSeenAt: NOW, declaredOffline: false, heartbeatWindowMs: 300_000, ...partial,
  };
}

function codingAgent(id: string, entries: Array<[source: "mac" | "agents" | "agents-otlp", agoMs: number, model?: string]>): CodingNowPayload["agents"][number] {
  return { id, activity: entries.map(([source, agoMs, model]) => ({ source, lastActivityAt: NOW - agoMs, model: model ?? null })) };
}

test("全部来源为空时是 idle，lastActiveAt 为 null", () => {
  assert.deepEqual(pickLiveActivity(input(), NOW), {
    kind: "idle", title: null, subtitle: null, artworkKey: null, alsoListening: null, lastActiveAt: null,
  });
});

test("在放歌且没有更高优先级时是 listening", () => {
  const picked = pickLiveActivity(input({ nowListening: listening({ music: music() }) }), NOW);
  assert.equal(picked.kind, "listening");
  assert.equal(picked.title, "Song");
  assert.equal(picked.subtitle, "Artist");
  assert.equal(picked.alsoListening, null);
  assert.equal(picked.lastActiveAt, NOW);
});

test("在播的剧是 watching，标题取条目、副标题取集数、封面取回 R2 objectKey", () => {
  const picked = pickLiveActivity(input({ nowWatching: watching() }), NOW);
  assert.equal(picked.kind, "watching");
  assert.equal(picked.title, "Frieren");
  assert.equal(picked.subtitle, "S1E3 · The Magician");
  assert.equal(picked.artworkKey, POSTER_KEY);
});

test("看剧优先于听歌，歌进 alsoListening", () => {
  const picked = pickLiveActivity(input({ nowWatching: watching(), nowListening: listening({ music: music() }) }), NOW);
  assert.equal(picked.kind, "watching");
  assert.deepEqual(picked.alsoListening, { title: "Song", artist: "Artist" });
});

test("暂停的剧不算在进行：暂停 + 在放歌落到 listening", () => {
  const picked = pickLiveActivity(input({ nowWatching: watching(true), nowListening: listening({ music: music() }) }), NOW);
  assert.equal(picked.kind, "listening");
  assert.equal(picked.title, "Song");
});

test("PS 在玩是 gaming，副标题是平台，图标是 PSN 远端图不进 artworkKey", () => {
  const picked = pickLiveActivity(input({ playingNow: playingNow({ playing: psPlaying() }) }), NOW);
  assert.equal(picked.kind, "gaming");
  assert.equal(picked.title, "PRAGMATA");
  assert.equal(picked.subtitle, "PS5");
  assert.equal(picked.artworkKey, null);
});

test("PS presence 超过 PLAYSTATION_STALE_MS 不算在玩", () => {
  const picked = pickLiveActivity(input({
    playingNow: playingNow({ observedAt: NOW - PLAYSTATION_STALE_MS - 1, playing: psPlaying() }),
  }), NOW);
  assert.equal(picked.kind, "idle");
});

test("Quest 在玩是 gaming，且盖住同时在玩的 PS（同游戏道约定）", () => {
  const picked = pickLiveActivity(input({
    playingNow: playingNow({ playing: psPlaying() }),
    questNow: questNow({ playing: questPlaying() }),
  }), NOW);
  assert.equal(picked.kind, "gaming");
  assert.equal(picked.title, "Asgard's Wrath 2");
  assert.equal(picked.subtitle, "Meta Quest");
  assert.equal(picked.lastActiveAt, NOW - 600_000);
});

test("Quest 快照超过 QUEST_STALE_MS 不算在玩，即使 available 为真", () => {
  const picked = pickLiveActivity(input({
    questNow: questNow({ observedAt: NOW - QUEST_STALE_MS, receivedAt: NOW - QUEST_STALE_MS, playing: questPlaying() }),
  }), NOW);
  assert.equal(picked.kind, "idle");
});

test("游戏优先于写代码", () => {
  const picked = pickLiveActivity(input({
    playingNow: playingNow({ playing: psPlaying() }),
    codingNow: codingNow({ agents: [codingAgent("claude", [["mac", 60_000, "claude-opus-5-5"]])] }),
  }), NOW);
  assert.equal(picked.kind, "gaming");
});

test("写代码取最近活跃 agent 的显示名与模型", () => {
  const picked = pickLiveActivity(input({
    codingNow: codingNow({ agents: [codingAgent("claude", [["mac", 60_000, "claude-opus-5-5"]])] }),
  }), NOW);
  assert.equal(picked.kind, "coding");
  assert.equal(picked.title, "Claude Code");
  assert.equal(picked.subtitle, "claude-opus-5-5");
});

test("多个 agent 同时活跃时副标题是「模型 · +N」", () => {
  const picked = pickLiveActivity(input({
    codingNow: codingNow({ agents: [
      codingAgent("claude", [["mac", 300_000, "claude-opus-5-5"]]),
      codingAgent("cursor", [["agents", 60_000, "gpt-5.5"]]),
      codingAgent("pi", [["mac", 120_000]]),
    ] }),
  }), NOW);
  assert.equal(picked.kind, "coding");
  assert.equal(picked.title, "Cursor");
  assert.equal(picked.subtitle, "gpt-5.5 · +2");
});

test("写代码 + 听歌 → coding 带 alsoListening", () => {
  const picked = pickLiveActivity(input({
    codingNow: codingNow({ agents: [codingAgent("claude", [["mac", 60_000, "claude-opus-5-5"]])] }),
    nowListening: listening({ music: music() }),
  }), NOW);
  assert.equal(picked.kind, "coding");
  assert.deepEqual(picked.alsoListening, { title: "Song", artist: "Artist" });
});

test("写代码窗口边界：14 分 59 秒算活跃，15 分 01 秒不算", () => {
  const at = (agoMs: number) => input({ codingNow: codingNow({ agents: [codingAgent("claude", [["mac", agoMs]])] }) });
  assert.equal(pickLiveActivity(at(CODING_ACTIVE_WINDOW_MS - 60_000), NOW).kind, "coding");
  assert.equal(pickLiveActivity(at(CODING_ACTIVE_WINDOW_MS + 60_000), NOW).kind, "idle");
});

test("Mac 声明离线时 mac 来源的活动不算，远端来源仍算", () => {
  const offline = { declaredOffline: true };
  const macOnly = pickLiveActivity(input({
    codingNow: codingNow({ ...offline, agents: [codingAgent("claude", [["mac", 60_000, "claude-opus-5-5"]])] }),
  }), NOW);
  assert.equal(macOnly.kind, "idle");
  const remote = pickLiveActivity(input({
    codingNow: codingNow({ ...offline, agents: [codingAgent("cursor", [["agents", 60_000, "gpt-5.5"]])] }),
  }), NOW);
  assert.equal(remote.kind, "coding");
  assert.equal(remote.title, "Cursor");
});

test("暂停的歌不算在进行", () => {
  const picked = pickLiveActivity(input({ nowListening: listening({ music: music({ state: "paused" }) }) }), NOW);
  assert.equal(picked.kind, "idle");
  assert.equal(picked.lastActiveAt, NOW, "暂停仍是最近一次活动");
});

test("Mac 离线时 apple-music 的歌不算，HomePod 的仍算", () => {
  const mac = pickLiveActivity(input({ nowListening: listening({ declaredOffline: true, music: music() }) }), NOW);
  assert.equal(mac.kind, "idle");
  const homepod = pickLiveActivity(input({
    nowListening: listening({ declaredOffline: true, music: music({ source: "homepod" }) }),
  }), NOW);
  assert.equal(homepod.kind, "listening");
});

test("推断的别处播放算听歌，过了窗口不算", () => {
  const elsewhere = {
    title: "Elsewhere", artist: "Someone", album: null, artworkUrl: null, songId: null,
    startedAt: NOW - 60_000, durationMs: 180_000, marginMs: 3_000,
  };
  const live = pickLiveActivity(input({ nowListening: listening({ elsewhere }) }), NOW);
  assert.equal(live.kind, "listening");
  assert.equal(live.title, "Elsewhere");
  const expired = { ...elsewhere, startedAt: NOW - 400_000 };
  const gone = pickLiveActivity(input({ nowListening: listening({ elsewhere: expired }) }), NOW);
  assert.equal(gone.kind, "idle");
});

test("idle 的 lastActiveAt 取各来源最近一次活动的最大值", () => {
  const picked = pickLiveActivity(input({
    playingNow: playingNow({ online: false, observedAt: NOW - PLAYSTATION_STALE_MS - 60_000, lastOnlineAt: NOW - 1_800_000 }),
    codingNow: codingNow({ agents: [codingAgent("claude", [["mac", 3_600_000]])] }),
  }), NOW);
  assert.equal(picked.kind, "idle");
  assert.equal(picked.lastActiveAt, NOW - 1_800_000);
});
