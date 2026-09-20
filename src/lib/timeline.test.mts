import assert from "node:assert/strict";
import { test } from "node:test";
import {
  TIMELINE_WINDOW_MS,
  composeTimeline,
  groupTimelineByDay,
  timelineDayKey,
  timelineDayLabel,
  timelineTime,
  type TimelineSources,
} from "./timeline.ts";
import type { VercelDeployment } from "./vercel-deployments-types.ts";
import type { PlaystationGame, TrophyUnlock, WatchingItem, Workout } from "./types.ts";

const AT = Date.parse("2026-09-20T10:00:00Z");

function watchItem(overrides: Partial<WatchingItem> = {}): WatchingItem {
  return {
    id: "emby-1",
    title: "Frieren",
    subtitle: "S01E05 · Phantoms of the Dead",
    progress: 42.4,
    poster: "/img/aaa.webp",
    backdrop: "/img/bbb.webp",
    type: "Episode",
    year: 2023,
    link: "https://emby.example/item/1",
    playedAt: new Date(AT).toISOString(),
    ...overrides,
  };
}

function game(overrides: Partial<PlaystationGame> = {}): PlaystationGame {
  return {
    titleId: "CUSA00001",
    name: "Pragmata",
    category: "ps5_native_game",
    playCount: 3,
    firstPlayedAt: AT - 86_400_000,
    lastPlayedAt: AT - 3_600_000,
    playDurationMs: 7_200_000,
    imageUrl: "https://image.api.playstation.com/cover.png",
    service: "ps_plus",
    preOrder: false,
    ...overrides,
  };
}

function unlock(overrides: Partial<TrophyUnlock> = {}): TrophyUnlock {
  return {
    npCommunicationId: "NPWR00001_00",
    id: 12,
    groupId: "default",
    titleName: "Pragmata",
    trophyName: "First Contact",
    type: "gold",
    iconUrl: "https://psnobj.example/trophy.png",
    earnedAt: AT - 7_200_000,
    ...overrides,
  };
}

function workout(overrides: Partial<Workout> = {}): Workout {
  return {
    id: "hk-1",
    activityType: "Fencing",
    startedAt: AT - 10_800_000,
    endedAt: AT - 7_200_000,
    secondsFromGMT: 8 * 3600,
    durationSeconds: 3_600,
    distanceMeters: null,
    activeEnergyKcal: 420,
    averageHeartRateBpm: 132,
    maximumHeartRateBpm: 170,
    elevationAscendedMeters: null,
    indoor: true,
    ...overrides,
  };
}

function deployment(overrides: Partial<VercelDeployment> = {}): VercelDeployment {
  return {
    id: "dpl_1",
    state: "READY",
    createdAt: AT - 1_800_000,
    buildDurationMs: 42_000,
    target: "production",
    commit: { sha: "4569931abcdef", branch: "main", message: "docs(readme): 换成英文界面版\n\n正文" },
    ...overrides,
  };
}

test("各来源并成一条倒序流水，时刻统一成 epoch 毫秒", () => {
  const sources: TimelineSources = {
    watching: { items: [watchItem()] },
    playing: { observedAt: AT, items: [game()] },
    trophies: {
      observedAt: AT,
      profile: { } as never,
      earned: { } as never,
      recent: [unlock()],
      titles: [],
    },
    workouts: { items: [workout()], pushedAt: AT },
    deployments: { fetchedAt: AT, production: deployment(), recent: [] },
  };

  const events = composeTimeline(sources);
  assert.deepEqual(events.map((event) => event.kind), ["watch", "deploy", "play", "trophy", "workout"]);
  // ISO 字符串的 playedAt 变成了毫秒
  assert.equal(events[0].at, AT);
  assert.equal(events[0].meta, "42%");
  assert.equal(events[0].portrait, true);
  assert.equal(events[1].title, "docs(readme): 换成英文界面版");
  assert.equal(events[1].subtitle, "4569931");
  assert.equal(events[2].meta, null, "累计游玩次数不当成这一次的事实");
  assert.equal(events[4].meta, "1:00:00");
});

test("认不出时刻的条目直接不进流水，不糊一个「现在」上去", () => {
  const events = composeTimeline({
    watching: { items: [watchItem({ id: "a", playedAt: null }), watchItem({ id: "b", playedAt: "not a date" })] },
    playing: { observedAt: AT, items: [game({ lastPlayedAt: null })] },
  });
  assert.deepEqual(events, []);
});

test("来源缺席或降级（undefined）时跳过它，其余照常并", () => {
  const events = composeTimeline({ workouts: { items: [workout()], pushedAt: AT } });
  assert.equal(events.length, 1);
  assert.equal(events[0].kind, "workout");
  assert.deepEqual(composeTimeline({}), []);
});

test("同一条目只留一条，保留时刻较新的那份", () => {
  const events = composeTimeline({
    watching: {
      items: [
        watchItem({ id: "dup", playedAt: new Date(AT - 86_400_000).toISOString() }),
        watchItem({ id: "dup", playedAt: new Date(AT).toISOString(), title: "Frieren (newer)" }),
      ],
    },
  });
  assert.equal(events.length, 1);
  assert.equal(events[0].title, "Frieren (newer)");
});

test("奖杯坐标是三件一套：同款游戏里的重名奖杯不会互相顶掉", () => {
  const events = composeTimeline({
    trophies: {
      observedAt: AT,
      profile: { } as never,
      earned: { } as never,
      recent: [
        unlock({ id: 1, groupId: "default", trophyName: "Collector" }),
        unlock({ id: 1, groupId: "001", trophyName: "Collector", earnedAt: AT - 100 }),
      ],
      titles: [],
    },
  });
  assert.equal(events.length, 2);
});

test("部署只收生产环境里真的上线了的那几次，预览和失败的不进来", () => {
  const events = composeTimeline({
    deployments: {
      fetchedAt: AT,
      production: deployment({ id: "dpl_prod" }),
      recent: [
        deployment({ id: "dpl_prod" }), // production 和 recent 里的同一次只画一条
        deployment({ id: "dpl_preview", target: "preview" }),
        deployment({ id: "dpl_error", state: "ERROR" }),
        deployment({ id: "dpl_building", state: "BUILDING" }),
      ],
    },
  });
  assert.deepEqual(events.map((event) => event.id), ["deploy:dpl_prod"]);
  assert.equal(events[0].meta, "42s");
});

test("没有提交信息的部署给一句兜底标题", () => {
  const events = composeTimeline({
    deployments: { fetchedAt: AT, production: deployment({ commit: null }), recent: [] },
  });
  assert.equal(events[0].title, "Production deployment");
  assert.equal(events[0].subtitle, null);
});

test("截到 limit 条，留下的是最近的", () => {
  const items = Array.from({ length: 40 }, (_, index) =>
    watchItem({ id: `w${index}`, playedAt: new Date(AT - index * 60_000).toISOString() }),
  );
  const events = composeTimeline({ watching: { items } }, { limit: 5 });
  assert.equal(events.length, 5);
  assert.deepEqual(events.map((event) => event.id), ["watch:w0", "watch:w1", "watch:w2", "watch:w3", "watch:w4"]);
});

test("分天按站点时区（UTC+8）切，跨过当地午夜就是新的一天", () => {
  // 15:59Z 是当地 23:59，16:00Z 已经是第二天 00:00
  const beforeMidnight = Date.parse("2026-09-20T15:59:00Z");
  const afterMidnight = Date.parse("2026-09-20T16:00:00Z");
  assert.equal(timelineDayKey(beforeMidnight), "2026-09-20");
  assert.equal(timelineDayKey(afterMidnight), "2026-09-21");

  const days = groupTimelineByDay(
    composeTimeline({
      watching: {
        items: [
          watchItem({ id: "late", playedAt: new Date(afterMidnight).toISOString() }),
          watchItem({ id: "early", playedAt: new Date(beforeMidnight).toISOString() }),
        ],
      },
    }),
  );
  assert.deepEqual(days.map((day) => day.key), ["2026-09-21", "2026-09-20"]);
  assert.deepEqual(days.map((day) => day.events.length), [1, 1]);
  assert.equal(timelineTime(beforeMidnight), "11:59 PM");
});

test("分组标题：今天、昨天，再往前给绝对日期；首帧（now=0）一律绝对日期", () => {
  const now = Date.parse("2026-09-21T02:00:00Z"); // 当地 10:00
  assert.equal(timelineDayLabel("2026-09-21", now), "Today");
  assert.equal(timelineDayLabel("2026-09-20", now), "Yesterday");
  assert.equal(timelineDayLabel("2026-09-15", now), "Tue, Sep 15");
  assert.equal(timelineDayLabel("2026-09-21", 0), "Mon, Sep 21");
});

test("窗口从最新那条往回切：半年前还挂在「最近在玩」里的游戏不占格子", () => {
  const events = composeTimeline({
    watching: { items: [watchItem({ id: "fresh" })] },
    playing: {
      observedAt: AT,
      items: [
        game({ titleId: "recent", lastPlayedAt: AT - 10 * 86_400_000 }),
        game({ titleId: "stale", lastPlayedAt: AT - 200 * 86_400_000 }),
      ],
    },
  });
  assert.deepEqual(events.map((event) => event.id), ["watch:fresh", "play:recent"]);
});

test("切窗锚在最新那条上，不是当下：整份数据都很旧时照样画得出来", () => {
  const ancient = AT - 400 * 86_400_000;
  const events = composeTimeline({
    watching: {
      items: [
        watchItem({ id: "a", playedAt: new Date(ancient).toISOString() }),
        watchItem({ id: "b", playedAt: new Date(ancient - TIMELINE_WINDOW_MS - 1).toISOString() }),
      ],
    },
  });
  assert.deepEqual(events.map((event) => event.id), ["watch:a"]);
});
