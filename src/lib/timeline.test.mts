import assert from "node:assert/strict";
import { test } from "node:test";

import type { WatchingItem } from "./types.ts";
import {
  buildTimeline,
  formatTimelineClock,
  groupTimelineDays,
  parseTimelineTime,
  timelineDayKey,
  timelineSourceNames,
  TIMELINE_LIMIT,
} from "./timeline.ts";

const NOW = Date.parse("2026-09-20T12:00:00+08:00");

function watching(partial: Partial<WatchingItem> & Pick<WatchingItem, "id" | "title">): WatchingItem {
  return {
    subtitle: "",
    progress: 0,
    poster: null,
    backdrop: null,
    type: "Episode",
    year: 2023,
    link: null,
    playedAt: null,
    ...partial,
  };
}

test("parseTimelineTime 认 epoch 毫秒和 ISO，丢掉空值和非法值", () => {
  assert.equal(parseTimelineTime(NOW), NOW);
  assert.equal(parseTimelineTime("2026-09-20T04:00:00.000Z"), NOW);
  assert.equal(parseTimelineTime(0), null);
  assert.equal(parseTimelineTime(-1), null);
  assert.equal(parseTimelineTime(""), null);
  assert.equal(parseTimelineTime("not-a-date"), null);
  assert.equal(parseTimelineTime(null), null);
});

test("空输入得到空时间线", () => {
  assert.deepEqual(buildTimeline({}, NOW), []);
  assert.deepEqual(groupTimelineDays([], NOW), []);
});

test("只有一路带时间戳的数据也能成组", () => {
  const events = buildTimeline(
    {
      workouts: {
        pushedAt: NOW,
        items: [
          {
            id: "w1",
            activityType: "Fencing",
            startedAt: NOW - 3_600_000,
            endedAt: NOW - 3_000_000,
            secondsFromGMT: 28800,
            durationSeconds: 600,
            distanceMeters: null,
            activeEnergyKcal: 80,
            averageHeartRateBpm: null,
            maximumHeartRateBpm: null,
            elevationAscendedMeters: null,
            indoor: false,
          },
        ],
      },
    },
    NOW,
  );
  assert.equal(events.length, 1);
  assert.equal(events[0].source, "workout");
  assert.equal(events[0].title, "Fencing");
  assert.deepEqual(timelineSourceNames(events), ["Workout"]);
  const days = groupTimelineDays(events, NOW);
  assert.equal(days.length, 1);
  assert.equal(days[0].label, "Today");
});

test("跨天按站点时区分组，今天 / 昨天 / 带星期的日期", () => {
  const yesterday = Date.parse("2026-09-19T22:00:00+08:00");
  const lastYear = Date.parse("2025-09-14T09:00:00+08:00");
  const events = buildTimeline(
    {
      workouts: {
        pushedAt: NOW,
        items: [
          {
            id: "today",
            activityType: "Cycling",
            startedAt: NOW - 60_000,
            endedAt: NOW - 1_000,
            secondsFromGMT: 28800,
            durationSeconds: 59,
            distanceMeters: 1000,
            activeEnergyKcal: null,
            averageHeartRateBpm: null,
            maximumHeartRateBpm: null,
            elevationAscendedMeters: null,
            indoor: true,
          },
          {
            id: "yesterday",
            activityType: "Skating",
            startedAt: yesterday - 60_000,
            endedAt: yesterday,
            secondsFromGMT: 28800,
            durationSeconds: 60,
            distanceMeters: null,
            activeEnergyKcal: 10,
            averageHeartRateBpm: null,
            maximumHeartRateBpm: null,
            elevationAscendedMeters: null,
            indoor: false,
          },
          {
            id: "old",
            activityType: "Fencing",
            startedAt: lastYear - 60_000,
            endedAt: lastYear,
            secondsFromGMT: 28800,
            durationSeconds: 60,
            distanceMeters: null,
            activeEnergyKcal: 10,
            averageHeartRateBpm: null,
            maximumHeartRateBpm: null,
            elevationAscendedMeters: null,
            indoor: false,
          },
        ],
      },
    },
    NOW,
  );
  const days = groupTimelineDays(events, NOW);
  assert.deepEqual(
    days.map((day) => [day.label, day.events.map((event) => event.title)]),
    [
      ["Today", ["Cycling"]],
      ["Yesterday", ["Skating"]],
      ["Sun, Sep 14, 2025", ["Fencing"]],
    ],
  );
});

test("正在听、正在看、正在玩去重后进 Now 组", () => {
  const current = watching({
    id: "22099",
    title: "我推的孩子",
    subtitle: "S1:E5 · 恋爱实境秀",
    playedAt: "2026-09-19T12:00:00.000Z",
    poster: "/img/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.webp",
  });
  const events = buildTimeline(
    {
      nowListening: {
        idle: false,
        music: {
          source: "apple-music",
          state: "playing",
          title: "夜に駆ける",
          artist: "YOASOBI",
          album: "夜に駆ける - Single",
          trackId: "1490256995",
          artworkUrl: "https://example.com/art.jpg",
          positionMs: 1000,
          durationMs: 200000,
          repeatOne: false,
          observedAt: NOW - 1000,
        },
        receivedAt: NOW,
        id: "album",
        link: "https://music.apple.com/song",
        songId: "1490256995",
        upcomingSongIds: [],
        hasLyrics: true,
        expiresInMs: null,
      },
      watching: { items: [current] },
      nowWatching: {
        nowPlaying: {
          itemId: "22099",
          paused: false,
          progress: 36,
          client: "Infuse",
          deviceName: "Mac",
          playMethod: "directstream",
          media: null,
          positionMs: 1000,
          durationMs: 2000,
        },
        current,
      },
      playing: {
        observedAt: NOW,
        items: [
          {
            titleId: "PPSA02530_00",
            name: "PRAGMATA",
            category: null,
            playCount: 3,
            firstPlayedAt: NOW - 86_400_000,
            lastPlayedAt: NOW - 3_600_000,
            playDurationMs: 3_600_000,
            imageUrl: "https://example.com/game.png",
            service: null,
            preOrder: false,
          },
        ],
      },
      playingNow: {
        observedAt: NOW,
        online: true,
        availability: "availableToPlay",
        platform: "PS5",
        lastOnlineAt: NOW,
        playing: {
          titleId: "PPSA02530_00",
          title: "PRAGMATA",
          format: "PS5",
          launchPlatform: "PS5",
          iconUrl: "https://example.com/game.png",
        },
      },
    },
    NOW,
  );

  assert.deepEqual(
    events.map((event) => [event.source, event.live, event.title]),
    [
      ["playing", true, "PRAGMATA"],
      ["listening", true, "夜に駆ける"],
      ["watching", true, "我推的孩子"],
    ],
  );
  assert.equal(events.filter((event) => event.source === "watching").length, 1);
  assert.equal(events.filter((event) => event.source === "playing").length, 1);
  assert.deepEqual(
    groupTimelineDays(events, NOW).map((day) => day.label),
    ["Now"],
  );
});

test("没有时间戳的最近在看不进时间线；空闲的正在听也不进", () => {
  const events = buildTimeline(
    {
      nowListening: {
        idle: true,
        music: null,
        receivedAt: NOW,
        id: null,
        link: null,
        songId: null,
        upcomingSongIds: [],
        hasLyrics: false,
        expiresInMs: null,
      },
      watching: {
        items: [
          watching({ id: "1", title: "无时间戳", playedAt: null }),
          watching({ id: "2", title: "有时间戳", playedAt: "2026-09-18T03:00:00.000Z" }),
        ],
      },
    },
    NOW,
  );
  assert.deepEqual(
    events.map((event) => event.title),
    ["有时间戳"],
  );
});

test("奖杯、写代码、前台应用按各自时间戳进入", () => {
  const events = buildTimeline(
    {
      trophies: {
        observedAt: NOW,
        profile: {
          onlineId: "lyjw",
          avatarUrl: null,
          plus: true,
          level: 1,
          tier: 1,
          trophyPoint: 0,
          levelBasePoint: 0,
          levelNextPoint: 1,
          levelProgress: 0,
          earned: { platinum: 0, gold: 0, silver: 0, bronze: 1 },
        },
        earned: { platinum: 0, gold: 0, silver: 0, bronze: 1 },
        recent: [
          {
            npCommunicationId: "NPWR1",
            id: 12,
            groupId: "default",
            titleName: "PRAGMATA",
            trophyName: "First step",
            type: "bronze",
            iconUrl: "https://example.com/trophy.png",
            earnedAt: NOW - 2 * 3_600_000,
          },
        ],
        titles: [],
      },
      vibeCoding: {
        agents: [
          {
            id: "claude",
            label: "Claude Code",
            icon: "anthropic",
            models: [],
            currentModel: "claude-opus-4",
            lastActivityAt: "2026-09-20T02:00:00.000Z",
            active: true,
            topModel: "claude-opus-4",
            today: null,
            usageStatus: {
              state: "ok",
              collectedAt: "2026-09-20T02:00:00.000Z",
              error: null,
              coverageStart: "2026-01-01",
              coverageEnd: "2026-09-20",
              precision: "measured",
              costComplete: true,
            },
            plan: null,
            limits: [],
            limitsError: null,
            limitsAt: null,
          },
        ],
        totals: null,
        topModels: [],
        collectedAt: null,
        source: "push",
        pushedAt: NOW,
        limitsStaleAfterMs: 90_000,
        lastSeenAt: NOW,
        declaredOffline: false,
        heartbeatWindowMs: 300_000,
        offlineAtSource: false,
      },
      desktop: {
        desktop: {
          applicationName: "Ghostty",
          bundleIdentifier: "com.mitchellh.ghostty",
          iconUrl: "/img/bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb.png",
          observedAt: NOW - 5_000,
        },
        receivedAt: NOW,
        lastSeenAt: NOW,
        declaredOffline: false,
        heartbeatWindowMs: 300_000,
        offlineAtSource: false,
      },
    },
    NOW,
  );

  assert.deepEqual(
    events.map((event) => event.source),
    ["desktop", "coding", "trophy"],
  );
  assert.equal(events.find((event) => event.source === "coding")?.live, true);
  assert.equal(events.find((event) => event.source === "desktop")?.title, "Ghostty");
  assert.equal(events.find((event) => event.source === "trophy")?.summary, "PRAGMATA · Bronze");
});

test("离线的前台应用和停掉的播放不进时间线", () => {
  assert.deepEqual(
    buildTimeline(
      {
        desktop: {
          desktop: {
            applicationName: "Ghostty",
            bundleIdentifier: "com.mitchellh.ghostty",
            iconUrl: null,
            observedAt: NOW,
          },
          receivedAt: NOW,
          lastSeenAt: NOW - 3_600_000,
          declaredOffline: true,
          heartbeatWindowMs: 300_000,
          offlineAtSource: true,
        },
        nowListening: {
          idle: false,
          music: {
            source: "apple-music",
            state: "stopped",
            title: "已停",
            artist: "A",
            album: "B",
            trackId: "1",
            artworkUrl: null,
            positionMs: 0,
            durationMs: 1,
            repeatOne: false,
            observedAt: NOW,
          },
          receivedAt: NOW,
          id: "1",
          link: null,
          songId: "1",
          upcomingSongIds: [],
          hasLyrics: false,
          expiresInMs: null,
        },
      },
      NOW,
    ),
    [],
  );
});

test("超过上限时只留最新的若干条", () => {
  const items = Array.from({ length: TIMELINE_LIMIT + 5 }, (_, index) =>
    watching({
      id: String(index),
      title: `Title ${index}`,
      playedAt: new Date(NOW - index * 60_000).toISOString(),
    }),
  );
  const events = buildTimeline({ watching: { items } }, NOW);
  assert.equal(events.length, TIMELINE_LIMIT);
  assert.equal(events[0].title, "Title 0");
});

test("时钟和日历日用站点时区", () => {
  assert.equal(timelineDayKey(NOW), "2026-09-20");
  assert.equal(formatTimelineClock(NOW), "12:00 PM");
});
