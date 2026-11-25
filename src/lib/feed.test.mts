import assert from "node:assert/strict";
import test from "node:test";

import type { StatusViewKey } from "@shared/status-views.ts";
import type { FirstScreen } from "./first-screen.ts";
import { FEED_CACHE_CONTROL, NO_STORE } from "./site-policy.ts";
import { buildFeedItems, feedUpdatedAt, type FeedSnapshot } from "./feed/items.ts";
import {
  ALL_FEED_TYPES,
  DEFAULT_FEED_LIMIT,
  DEFAULT_FEED_TYPES,
  MAX_FEED_LIMIT,
  MIN_FEED_LIMIT,
  canonicalFeedUrl,
  parseFeedQuery,
  requiredViewsForTypes,
} from "./feed/query.ts";
import { etagMatches, serveFeed } from "./feed/response.ts";
import { escapeXml, renderAtom, renderRss } from "./feed/xml.ts";

const FIXTURE_SNAPSHOT: FeedSnapshot = {
  digest: {
    headline: "奖杯有进账",
    highlights: [
      { topic: "trophies", value: 3, unit: "count", atLeast: true, caption: "trophies" },
      { topic: "gaming", value: 6.5, unit: "hours", atLeast: false, caption: "gaming" },
    ],
    model: "rules",
    generatedAt: Date.parse("2026-11-24T22:50:00Z"),
  },
  githubRepo: {
    repo: "LYJW131/lyjwpage",
    fetchedAt: Date.parse("2026-11-24T22:30:00Z"),
    totals: { commits: 3176, additions: 742265, deletions: 367027, contributors: 13 },
    contributors: [],
    recentCommits: [
      {
        sha: "31b1802",
        oid: "31b18029e7317e7c370bb9eeeaa7deed4ab2b0b3",
        title: "feat(site): 关掉维护页，页面恢复正常渲染 (#815)",
        authors: ["LYJW131", "claude"],
        committedAt: "2026-11-24T20:00:00Z",
        url: "https://github.com/LYJW131/lyjwpage/commit/31b18029e7317e7c370bb9eeeaa7deed4ab2b0b3",
        verified: true,
      },
    ],
  },
  siteDeployments: {
    fetchedAt: Date.parse("2026-11-24T22:45:00Z"),
    production: null,
    activeVersions: [],
    recent: [
      {
        id: "cloudflare-build:1",
        state: "READY",
        createdAt: Date.parse("2026-11-24T20:05:00Z"),
        buildDurationMs: 130_000,
        target: "production",
        commit: {
          sha: "31b18029e7317e7c370bb9eeeaa7deed4ab2b0b3",
          branch: "main",
          message: "feat(site): 关掉维护页，页面恢复正常渲染 (#815)",
        },
      },
    ],
  },
  trophies: {
    observedAt: Date.parse("2026-11-24T18:00:00Z"),
    profile: {
      onlineId: "BQDJS",
      avatarUrl: null,
      plus: true,
      level: 180,
      tier: 2,
      trophyPoint: 13155,
      levelBasePoint: 13140,
      levelNextPoint: 13230,
      levelProgress: 16,
      earned: { platinum: 5, gold: 24, silver: 110, bronze: 413 },
    },
    earned: { platinum: 5, gold: 24, silver: 108, bronze: 413 },
    titles: [],
    recent: [
      {
        npCommunicationId: "NPWR21008_00",
        id: 64,
        groupId: "002",
        titleName: "《地平线 西之绝境™》",
        trophyName: "与朗德拉对峙",
        type: "bronze",
        iconUrl: null,
        earnedAt: Date.parse("2026-11-24T17:30:00Z"),
      },
    ],
  },
  playing: {
    observedAt: Date.parse("2026-11-24T19:00:00Z"),
    items: [
      {
        titleId: "PPSA17903_00",
        name: "《地平线 西之绝境™》",
        category: "ps5_native_game",
        playCount: 36,
        firstPlayedAt: Date.parse("2025-11-01T00:00:00Z"),
        lastPlayedAt: Date.parse("2026-11-24T19:00:00Z"),
        playDurationMs: 334_540_000,
        imageUrl: null,
        service: "none(purchased)",
        preOrder: false,
      },
      {
        titleId: "PPSA01616_00",
        name: "Netflix",
        category: "ps5_native_media_app",
        playCount: 39,
        firstPlayedAt: Date.parse("2025-11-01T00:00:00Z"),
        lastPlayedAt: Date.parse("2026-11-24T19:30:00Z"),
        playDurationMs: 105_316_000,
        imageUrl: null,
        service: null,
        preOrder: false,
      },
      {
        titleId: "PPSA99999_00",
        name: "Upcoming Preorder",
        category: "ps5_native_game",
        playCount: 0,
        firstPlayedAt: null,
        lastPlayedAt: null,
        playDurationMs: null,
        imageUrl: null,
        service: "none(purchased)",
        preOrder: true,
      },
    ],
  },
  workouts: {
    pushedAt: Date.parse("2026-11-23T12:00:00Z"),
    items: [
      {
        id: "workout-1",
        activityType: "Fencing",
        startedAt: Date.parse("2026-11-23T11:00:00Z"),
        endedAt: Date.parse("2026-11-23T11:20:00Z"),
        secondsFromGMT: 28800,
        durationSeconds: 1222,
        distanceMeters: null,
        activeEnergyKcal: 147.6,
        elevationAscendedMeters: null,
        indoor: false,
      },
    ],
  },
  watching: {
    items: [
      {
        id: "22114",
        title: "我推的孩子",
        subtitle: "S2:E9 · 梦",
        progress: 0,
        poster: null,
        backdrop: null,
        type: "Episode",
        year: 2023,
        link: "https://emby.lyjw131.com/web/index.html#!/item?id=22114",
        playedAt: null,
      },
      {
        id: "22113",
        title: "我推的孩子",
        subtitle: "S2:E8 · 触发",
        progress: 0,
        poster: null,
        backdrop: null,
        type: "Episode",
        year: 2023,
        link: "https://emby.lyjw131.com/web/index.html#!/item?id=22113",
        playedAt: null,
      },
    ],
  },
  pulse: {
    generatedAt: Date.parse("2026-11-24T22:55:00Z"),
    window: {
      from: Date.parse("2026-11-23T22:55:00Z"),
      to: Date.parse("2026-11-24T22:55:00Z"),
    },
    lanes: {
      coding: { kind: "coding", segments: { startSec: [], endSec: [], value: [], agentSources: [] }, summary: { humanSeconds: 0, agentSeconds: 0, bothSeconds: 0 } },
      tokens: { kind: "tokens", buckets: { startSec: [], endSec: [], total: [], output: [], cacheRead: [] }, summary: { peakPerMinute: null, currentPerMinute: null, totalTokens: 0 } },
      listening: {
        kind: "state",
        segments: {
          startSec: [80_000, 80_010, 80_210],
          endSec: [80_200, 80_210, 80_810],
          state: [2, 2, 1],
          title: ["晴天", "稻香", "暂停曲"],
          subtitle: ["周杰伦", "周杰伦", "周杰伦"],
        },
        uncertain: {
          startSec: [70_000],
          endSec: [70_180],
          title: ["Idol"],
          subtitle: ["YOASOBI"],
          marginSec: [60],
        },
        summary: { activeSeconds: 580, titles: 3 },
      },
      watching: {
        kind: "state",
        segments: {
          startSec: [75_000],
          endSec: [76_500],
          state: [2],
          title: ["我推的孩子"],
          subtitle: ["S2:E9 · 梦"],
        },
        summary: { activeSeconds: 1500, titles: 1 },
      },
      gaming: { kind: "state", segments: { startSec: [], endSec: [], state: [], title: [], subtitle: [] }, summary: { activeSeconds: 0, titles: 0 } },
      charging: { kind: "power", segments: { startSec: [], endSec: [], watts: [] }, currentPowerW: null, summary: { peakW: null, energyWh: 0 } },
      activity: { kind: "steps", buckets: { startSec: [], endSec: [], steps: [] }, workouts: { startSec: [], endSec: [], activityType: [] }, summary: { steps: 0 } },
    },
  },
  agentStatus: {
    fetchedAt: Date.parse("2026-11-24T22:50:00Z"),
    agents: [
      {
        id: "claude",
        name: "Claude",
        indicator: "partial_outage",
        statusUrl: "https://status.claude.com",
        components: [],
        incidents: [
          {
            id: "inc-1",
            title: "Elevated API errors",
            status: "investigating",
            url: "https://status.claude.com/incidents/inc-1",
            updatedAt: "2026-11-24T21:15:00Z",
            body: "<p>Investigating <script>alert(1)</script>elevated errors.</p>",
          },
        ],
        note: null,
        stale: false,
      },
    ],
  },
};

function makeServices(
  overrides: Partial<Record<StatusViewKey, FirstScreen<StatusViewKey>>> = {},
  called: StatusViewKey[] = [],
) {
  const map: Partial<Record<StatusViewKey, unknown>> = {
    digest: FIXTURE_SNAPSHOT.digest,
    githubRepo: FIXTURE_SNAPSHOT.githubRepo,
    siteDeployments: FIXTURE_SNAPSHOT.siteDeployments,
    trophies: FIXTURE_SNAPSHOT.trophies,
    playing: FIXTURE_SNAPSHOT.playing,
    workouts: FIXTURE_SNAPSHOT.workouts,
    watching: FIXTURE_SNAPSHOT.watching,
    pulse: FIXTURE_SNAPSHOT.pulse,
    agentStatus: FIXTURE_SNAPSHOT.agentStatus,
  };
  return {
    status: async <K extends StatusViewKey>(key: K): Promise<FirstScreen<K>> => {
      called.push(key);
      if (key in overrides) return overrides[key] as FirstScreen<K>;
      if (key in map) return { ok: true, data: map[key] } as FirstScreen<K>;
      return { ok: false, error: "unavailable" };
    },
  };
}

test("parseFeedQuery 解析默认值、合法筛选与非法参数策略", () => {
  const defaults = parseFeedQuery(new URLSearchParams(), "rss");
  assert.equal(defaults.ok, true);
  assert.deepEqual(defaults.query, {
    format: "rss",
    types: [...DEFAULT_FEED_TYPES],
    tags: [],
    limit: DEFAULT_FEED_LIMIT,
  });

  const limitCases = [
    ["abc", DEFAULT_FEED_LIMIT],
    ["1.5", DEFAULT_FEED_LIMIT],
    ["", DEFAULT_FEED_LIMIT],
    ["0", MIN_FEED_LIMIT],
    ["-5", MIN_FEED_LIMIT],
    ["10000", MAX_FEED_LIMIT],
    ["7", 7],
  ] as const;
  for (const [raw, expected] of limitCases) {
    const parsed = parseFeedQuery(new URLSearchParams({ limit: raw }), "atom");
    assert.equal(parsed.ok, true, raw);
    assert.equal(parsed.query.limit, expected, raw);
    assert.equal(parsed.query.format, "atom");
  }

  const expanded = parseFeedQuery(new URLSearchParams("type=all&tag=PS5,Bronze&format=ATOM"), "rss");
  assert.equal(expanded.ok, true);
  assert.deepEqual(expanded.query.types, [...ALL_FEED_TYPES]);
  assert.deepEqual(expanded.query.tags, ["ps5", "bronze"]);
  assert.equal(expanded.query.format, "atom");

  const badType = parseFeedQuery(new URLSearchParams("type=commits,bogus"), "rss");
  assert.equal(badType.ok, false);
  assert.match(badType.error, /Unknown type "bogus"/);

  const badFormat = parseFeedQuery(new URLSearchParams("format=json"), "rss");
  assert.equal(badFormat.ok, false);
  assert.match(badFormat.error, /Invalid format "json"/);

  const lockedFormat = parseFeedQuery(new URLSearchParams("format=atom"), "rss", false);
  assert.equal(lockedFormat.ok, false);
  assert.match(lockedFormat.error, /only serves rss/);

  const sameFormat = parseFeedQuery(new URLSearchParams("format=rss"), "rss", false);
  assert.equal(sameFormat.ok, true);
  assert.equal(sameFormat.query.format, "rss");
});

test("requiredViewsForTypes 只请求被选中的最小视图集合并去重", () => {
  assert.deepEqual(requiredViewsForTypes(["commits"]), ["githubRepo"]);
  assert.deepEqual(requiredViewsForTypes(["watching", "listening"]), ["watching", "pulse"]);
  assert.deepEqual(requiredViewsForTypes(DEFAULT_FEED_TYPES), ["digest", "playing", "trophies", "workouts", "watching", "pulse"]);
});

test("buildFeedItems 过滤媒体应用与合并提交、补齐 watching 时间、支持 tag 筛选并按多样性前置", () => {
  const defaultQuery = parseFeedQuery(new URLSearchParams(), "rss");
  assert.equal(defaultQuery.ok, true);
  const items = buildFeedItems(FIXTURE_SNAPSHOT, defaultQuery.query);

  assert.deepEqual(items.slice(0, 6).map((item) => item.type), ["digest", "listening", "watching", "gaming", "trophies", "workouts"]);
  assert.equal(items.some((item) => item.type === "commits"), false, "默认流不包含 commits");
  assert.equal(items.some((item) => item.title.includes("Netflix")), false, "过滤 ps5_native_media_app");
  assert.equal(items.some((item) => item.title.includes("Upcoming Preorder")), false, "过滤未游玩预购游戏");
  assert.equal(items[0].title, "Digest: 奖杯有进账 · 3+ trophies, 6.5h gaming");

  const burstSnapshot: FeedSnapshot = {
    ...FIXTURE_SNAPSHOT,
    trophies: {
      ...FIXTURE_SNAPSHOT.trophies!,
      recent: [
        {
          npCommunicationId: "NPWR21008_00",
          id: 70,
          groupId: "002",
          titleName: "《地平线 西之绝境™》",
          trophyName: "完成所有任务",
          type: "gold",
          iconUrl: null,
          earnedAt: Date.parse("2026-11-24T22:40:00Z"),
        },
        {
          npCommunicationId: "NPWR21008_00",
          id: 71,
          groupId: "002",
          titleName: "《地平线 西之绝境™》",
          trophyName: "协助昆恩族",
          type: "bronze",
          iconUrl: null,
          earnedAt: Date.parse("2026-11-24T22:39:00Z"),
        },
        {
          npCommunicationId: "NPWR21008_00",
          id: 72,
          groupId: "002",
          titleName: "《地平线 西之绝境™》",
          trophyName: "升级幽魂护手",
          type: "silver",
          iconUrl: null,
          earnedAt: Date.parse("2026-11-24T22:38:00Z"),
        },
      ],
    },
    pulse: {
      ...FIXTURE_SNAPSHOT.pulse!,
      lanes: {
        ...FIXTURE_SNAPSHOT.pulse!.lanes,
        listening: {
          kind: "state",
          segments: {
            startSec: [81_000, 81_300, 81_600, 81_900, 82_200],
            endSec: [81_200, 81_500, 81_800, 82_100, 82_400],
            state: [2, 2, 2, 2, 2],
            title: ["Song 1", "Song 2", "Song 3", "Song 4", "Song 5"],
            subtitle: ["A", "A", "A", "A", "A"],
          },
          summary: { activeSeconds: 1000, titles: 5 },
        },
      },
    },
    githubRepo: {
      ...FIXTURE_SNAPSHOT.githubRepo!,
      recentCommits: [
        ...(FIXTURE_SNAPSHOT.githubRepo!.recentCommits ?? []),
        {
          sha: "deadbee",
          oid: "deadbeef00000000000000000000000000000000",
          title: "Merge remote-tracking branch 'origin/main' into t3/test",
          authors: ["LYJW131"],
          committedAt: "2026-11-24T21:00:00Z",
          url: "https://github.com/LYJW131/lyjwpage/commit/deadbeef00000000000000000000000000000000",
          verified: true,
        },
      ],
    },
  };

  const diverse = buildFeedItems(burstSnapshot, {
    format: "atom",
    types: [...DEFAULT_FEED_TYPES],
    tags: [],
    limit: 20,
  });
  assert.equal(new Set(diverse.slice(0, 3).map((item) => item.type)).size, 3, "前 3 条来自 3 个不同维度，不被连发奖杯或听歌刷屏");
  assert.equal(diverse.filter((item) => item.type === "listening").length, 3, "多类型混排时 listening 最多保留 3 条");

  const soloListening = buildFeedItems(burstSnapshot, {
    format: "atom",
    types: ["listening"],
    tags: [],
    limit: 20,
  });
  assert.equal(soloListening.length, 5, "单类型 listening 不受多类型上限裁剪");

  const commitsOnly = buildFeedItems(burstSnapshot, {
    format: "rss",
    types: ["commits"],
    tags: [],
    limit: 20,
  });
  assert.equal(commitsOnly.length, 1, "过滤 Merge remote-tracking branch 合并提交");
  assert.equal(commitsOnly[0].title, "feat(site): 关掉维护页，页面恢复正常渲染 (#815)");

  const tagged = buildFeedItems(FIXTURE_SNAPSHOT, {
    format: "rss",
    types: [...ALL_FEED_TYPES],
    tags: ["bronze", "fencing"],
    limit: 20,
  });
  assert.deepEqual(tagged.map((item) => item.type), ["trophies", "workouts"]);

  const watching = buildFeedItems(FIXTURE_SNAPSHOT, {
    format: "atom",
    types: ["watching"],
    tags: [],
    limit: 10,
  });
  assert.equal(watching.length, 2);
  assert.notEqual(watching[0].publishedAt, null, "同集在 pulse 中匹配时补齐时间");
  assert.equal(watching[1].publishedAt, null, "同剧其他集不跨集借用时间");

  const listening = buildFeedItems(FIXTURE_SNAPSHOT, {
    format: "atom",
    types: ["listening"],
    tags: [],
    limit: 10,
  });
  assert.equal(listening.length, 3);
  assert.equal(listening.some((item) => item.title.includes("暂停曲")), false, "paused 片段不生成收听条目");
  assert.equal(new Set(listening.map((item) => item.id)).size, 3, "同分钟内不同中文歌名 guid 不碰撞");
});

test("Atom 部署条目从 BUILDING 变为 READY 时保持 ID 与 published，推进 updated", () => {
  const createdAt = Date.parse("2026-11-24T20:00:00Z");
  const building: FeedSnapshot = {
    siteDeployments: {
      fetchedAt: createdAt + 10_000,
      production: null,
      activeVersions: [],
      recent: [{
        id: "cloudflare-build:2",
        state: "BUILDING",
        createdAt,
        buildDurationMs: null,
        target: "production",
        commit: { sha: "abcdef1234567", branch: "main", message: "feat(feed): build test" },
      }],
    },
  };
  const ready: FeedSnapshot = {
    siteDeployments: {
      fetchedAt: createdAt + 180_000,
      production: null,
      activeVersions: [],
      recent: [{
        id: "cloudflare-build:2",
        state: "READY",
        createdAt,
        buildDurationMs: 180_000,
        target: "production",
        commit: { sha: "abcdef1234567", branch: "main", message: "feat(feed): build test" },
      }],
    },
  };
  const query = { format: "atom" as const, types: ["deployments" as const], tags: [], limit: 10 };
  const [bItem] = buildFeedItems(building, query);
  const [rItem] = buildFeedItems(ready, query);
  assert.equal(bItem.id, rItem.id);
  assert.equal(bItem.publishedAt, rItem.publishedAt);
  assert.equal(bItem.updatedAt, createdAt);
  assert.equal(rItem.updatedAt, createdAt + 180_000);
  assert.equal(feedUpdatedAt([rItem], ready), createdAt + 180_000);

  const atom = renderAtom({
    title: "LYJW's Homepage",
    description: "Test",
    selfUrl: "https://lyjw.me/atom.xml?type=deployments",
    updatedAt: feedUpdatedAt([rItem], ready),
    items: [rItem],
  });
  assert.match(atom, /<published>2026-11-24T20:00:00\.000Z<\/published>/);
  assert.match(atom, /<updated>2026-11-24T20:03:00\.000Z<\/updated>/);
});

test("XML 序列化转义特殊字符并剥离非法控制字符，兼容 Atom 友链解析器", () => {
  assert.equal(escapeXml("A & <B> \"C\" 'D'\u0000\u0007\n"), "A &amp; &lt;B&gt; &quot;C&quot; &apos;D&apos;\n");

  const items = buildFeedItems(FIXTURE_SNAPSHOT, {
    format: "atom",
    types: ["digest", "commits", "incidents"],
    tags: [],
    limit: 10,
  });
  const doc = {
    title: "LYJW's Homepage",
    description: "Test feed",
    selfUrl: canonicalFeedUrl("/atom.xml", { format: "atom", types: ["digest", "commits", "incidents"], tags: [], limit: 10 }, "atom"),
    updatedAt: feedUpdatedAt(items, FIXTURE_SNAPSHOT),
    items,
  };

  const atom = renderAtom(doc);
  assert.match(atom, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(atom, /<link rel="alternate" type="text\/html" href="https:\/\/github\.com\/LYJW131\/lyjwpage\/commit\/31b18029e7317e7c370bb9eeeaa7deed4ab2b0b3" \/>/);
  assert.doesNotMatch(atom, /<script>/, "incident HTML 标签已剥离");

  const rss = renderRss({ ...doc, selfUrl: "https://lyjw.me/rss.xml" });
  assert.match(rss, /<rss version="2\.0" xmlns:atom="http:\/\/www\.w3\.org\/2005\/Atom">/);
  assert.match(rss, /<guid isPermaLink="false">tag:lyjw\.me,2026:commit:31b18029e7317e7c370bb9eeeaa7deed4ab2b0b3<\/guid>/);
});

test("serveFeed 端到端：按需取数、正确头、ETag/304、HEAD、400、部分降级与全挂 503", async () => {
  const called: StatusViewKey[] = [];
  const res = await serveFeed(
    new Request("https://lyjw.me/feed?type=commits&limit=10000"),
    makeServices({}, called),
    "rss",
  );
  assert.equal(res.status, 200);
  assert.deepEqual(called, ["githubRepo"], "只读取筛选到的视图");
  assert.equal(res.headers.get("Content-Type"), "application/rss+xml; charset=utf-8");
  assert.equal(res.headers.get("Cache-Control"), FEED_CACHE_CONTROL);
  assert.equal(res.headers.get("X-Content-Type-Options"), "nosniff");
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "*");
  const etag = res.headers.get("ETag");
  assert.ok(etag && etag.startsWith('"'));
  const xml = await res.text();
  assert.match(xml, /<title>feat\(site\): 关掉维护页，页面恢复正常渲染 \(#815\)<\/title>/);

  const notModified = await serveFeed(
    new Request("https://lyjw.me/feed?type=commits&limit=10000", {
      headers: { "If-None-Match": `W/${etag}` },
    }),
    makeServices(),
    "rss",
  );
  assert.equal(notModified.status, 304);
  assert.equal(await notModified.text(), "");

  const head = await serveFeed(
    new Request("https://lyjw.me/atom.xml?type=commits", { method: "HEAD" }),
    makeServices(),
    "atom",
  );
  assert.equal(head.status, 200);
  assert.equal(head.headers.get("Content-Type"), "application/atom+xml; charset=utf-8");
  assert.equal(await head.text(), "");

  const bad = await serveFeed(
    new Request("https://lyjw.me/feed?type=nope"),
    makeServices(),
    "rss",
  );
  assert.equal(bad.status, 400);
  assert.equal(bad.headers.get("Cache-Control"), NO_STORE);

  const partial = await serveFeed(
    new Request("https://lyjw.me/feed?type=commits,workouts"),
    makeServices({ workouts: { ok: false, error: "unavailable" } }),
    "rss",
  );
  assert.equal(partial.status, 200);
  assert.equal(partial.headers.get("Cache-Control"), NO_STORE, "部分降级不进缓存");

  const down = await serveFeed(
    new Request("https://lyjw.me/feed?type=commits"),
    makeServices({ githubRepo: { ok: false, error: "unavailable" } }),
    "rss",
  );
  assert.equal(down.status, 503);
  assert.equal(down.headers.get("Cache-Control"), NO_STORE);

  assert.equal(etagMatches('"abc"', '"abc"'), true);
  assert.equal(etagMatches('W/"abc", "def"', '"abc"'), true);
  assert.equal(etagMatches("*", '"abc"'), true);
  assert.equal(etagMatches('"xyz"', '"abc"'), false);
});
