import assert from "node:assert/strict";
import test from "node:test";

import { AwaitingReport } from "@shared/awaiting-report";
import { playedGamesMirror, trophiesMirror } from "@shared/playstation-store";
import { FakeStorage, installTestStorage } from "@shared/testing/fake-storage";
import type { PlaystationGame, TrophyCounts, TrophyProfile, TrophyTitle } from "@shared/types";
import { getTrophies } from "./playstation";

const OBSERVED_AT = 1_800_000_000_000;

function counts(): TrophyCounts {
  return { platinum: 0, gold: 0, silver: 0, bronze: 0 };
}

function profile(): TrophyProfile {
  return {
    onlineId: "me",
    avatarUrl: null,
    plus: false,
    level: 1,
    tier: 1,
    trophyPoint: 0,
    levelBasePoint: 0,
    levelNextPoint: 1,
    levelProgress: 0,
    earned: counts(),
  };
}

function title(overrides: Partial<TrophyTitle> = {}): TrophyTitle {
  return {
    npCommunicationId: "NPWR00001",
    name: "Some Game",
    localizedName: null,
    titleIds: [],
    iconUrl: null,
    platform: "PS5",
    progress: 0,
    defined: counts(),
    earned: counts(),
    lastUpdatedAt: null,
    playDurationMs: null,
    playCount: 0,
    firstPlayedAt: null,
    lastPlayedAt: null,
    service: null,
    preOrder: false,
    groups: [],
    trophies: [],
    ...overrides,
  };
}

function game(overrides: Partial<PlaystationGame> = {}): PlaystationGame {
  return {
    titleId: "PPSA00001",
    name: "Some Game",
    category: null,
    playCount: 0,
    firstPlayedAt: null,
    lastPlayedAt: null,
    playDurationMs: null,
    imageUrl: null,
    service: null,
    preOrder: false,
    ...overrides,
  };
}

async function withStorage<T>(run: (storage: FakeStorage) => Promise<T>): Promise<T> {
  const storage = new FakeStorage();
  installTestStorage(storage);
  try {
    return await run(storage);
  } finally {
    installTestStorage(null);
  }
}

async function seed(storage: FakeStorage, trophies: unknown, played?: unknown) {
  await storage.set(trophiesMirror.key, JSON.stringify(trophies));
  if (played !== undefined) await storage.set(playedGamesMirror.key, JSON.stringify(played));
}

test("还没收到奖杯遥测时报 AwaitingReport", async () => {
  await withStorage(async () => {
    await assert.rejects(getTrophies(), AwaitingReport);
  });
});

test("没有最近游玩时权益字段归一化：存储里缺 service / preOrder 键的给 null 与 false", async () => {
  await withStorage(async (storage) => {
    const bare = { ...title() } as Record<string, unknown>;
    delete bare.service;
    delete bare.preOrder;
    await seed(storage, { observedAt: OBSERVED_AT, profile: profile(), titles: [
      bare,
      { ...title({ npCommunicationId: "NPWR00002", service: "ps_plus", preOrder: true }) },
    ] });

    const { titles } = await getTrophies();
    assert.equal(titles[0].service, null);
    assert.equal(titles[0].preOrder, false);
    assert.equal(titles[1].service, "ps_plus");
    assert.equal(titles[1].preOrder, true);
  });
});

test("最近游玩是空列表同样走归一化", async () => {
  await withStorage(async (storage) => {
    const bare = { ...title() } as Record<string, unknown>;
    delete bare.service;
    delete bare.preOrder;
    await seed(storage,
      { observedAt: OBSERVED_AT, profile: profile(), titles: [bare] },
      { observedAt: OBSERVED_AT, items: [] });

    const { titles } = await getTrophies();
    assert.equal(titles[0].service, null);
    assert.equal(titles[0].preOrder, false);
  });
});

test("有最近游玩时把游玩统计与权益合进奖杯目录", async () => {
  await withStorage(async (storage) => {
    await seed(storage,
      {
        observedAt: OBSERVED_AT,
        profile: profile(),
        titles: [
          title({ titleIds: ["PPSA00001"], name: "Some Game" }),
          title({ npCommunicationId: "NPWR00002", titleIds: ["PPSA99999"], name: "Other" }),
        ],
      },
      {
        observedAt: OBSERVED_AT,
        items: [game({
          titleId: "PPSA00001",
          name: "某游戏",
          playCount: 7,
          playDurationMs: 3_600_000,
          firstPlayedAt: 1_000,
          lastPlayedAt: 2_000,
          service: "ps_plus",
          preOrder: true,
        })],
      });

    const { titles } = await getTrophies();
    const merged = titles[0];
    assert.equal(merged.localizedName, "某游戏");
    assert.equal(merged.playDurationMs, 3_600_000);
    assert.equal(merged.playCount, 7);
    assert.equal(merged.firstPlayedAt, 1_000);
    assert.equal(merged.lastPlayedAt, 2_000);
    assert.equal(merged.service, "ps_plus");
    assert.equal(merged.preOrder, true);

    const unmatched = titles[1];
    assert.equal(unmatched.localizedName, null);
    assert.equal(unmatched.service, null);
    assert.equal(unmatched.preOrder, false);
  });
});
