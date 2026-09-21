import assert from "node:assert/strict";
import test from "node:test";

import { mergeCoverage } from "@shared/pulse-assessment";
import { CODING_WINDOW_MS } from "@shared/pulse-coding";
import { listeningLevel } from "@shared/pulse-levels";
import { listeningPlay, listeningPlayCoverage, parseListeningPlay } from "@shared/pulse-listening";
import { withRequestState } from "@shared/request-state";
import { bareSnapshotFrom, telemetryState } from "@shared/telemetry";
import { MUSIC_PAUSE_GRACE_MS, pickNowListening } from "@/lib/now-listening";
import type { Liveness } from "@/lib/reporter-liveness";
import type { ListeningItem, LocalNowPlaying } from "@/lib/types";
import type { StoredHomePod } from "@shared/homepod-store";

const NOW = 1_700_000_000_000;
const online: Liveness = { lastSeenAt: NOW, declaredOffline: false };
const neverSeen: Liveness = { lastSeenAt: 0, declaredOffline: false };

function track(
  state: LocalNowPlaying["state"],
  title: string,
  artist: string | null = null,
  observedAt = NOW,
): LocalNowPlaying {
  return {
    source: "apple-music",
    state,
    title,
    artist,
    album: null,
    trackId: null,
    artworkUrl: null,
    positionMs: 0,
    durationMs: 180_000,
    repeatOne: false,
    observedAt,
  };
}

function homePod(music: LocalNowPlaying, receivedAt = NOW): StoredHomePod {
  return { music: { ...music, source: "homepod" }, receivedAt };
}

function score(
  live: Liveness,
  mac: LocalNowPlaying | null,
  pod: StoredHomePod | null,
  now = NOW,
) {
  telemetryState.activeModules = new Set(["appleMusic"]);
  return listeningLevel(
    pickNowListening(bareSnapshotFrom(pod, { music: mac, receivedAt: NOW }), live, now),
  );
}

test("bare listening：Mac 在播 → 3，hint 是 artist – title", async () => {
  await withRequestState(async () => {
    assert.deepEqual(score(online, track("playing", "Helpless", "Hamilton"), null), {
      level: 3,
      hint: "Hamilton – Helpless",
    });
  });
});

test("bare listening：Mac 暂停未满宽限 → 2", async () => {
  await withRequestState(async () => {
    assert.deepEqual(
      score(online, track("paused", "Helpless", "Hamilton", NOW - MUSIC_PAUSE_GRACE_MS + 1), null),
      { level: 2, hint: "Hamilton – Helpless" },
    );
  });
});

test("bare listening：Mac 停了、HomePod 在播 → 3，用 HomePod 曲名", async () => {
  await withRequestState(async () => {
    assert.deepEqual(
      score(online, track("stopped", "Old"), homePod(track("playing", "Home", "Pod"))),
      { level: 3, hint: "Pod – Home" },
    );
  });
});

test("bare listening：HomePod 暂停超过宽限 → idle 0", async () => {
  await withRequestState(async () => {
    assert.deepEqual(
      score(
        online,
        null,
        homePod(track("paused", "Home", "Pod", NOW - MUSIC_PAUSE_GRACE_MS - 1)),
      ),
      { level: 0, hint: null },
    );
  });
});

test("bare listening：Mac 按存活已离线、没有 HomePod → 0", async () => {
  await withRequestState(async () => {
    assert.deepEqual(score(neverSeen, track("playing", "Helpless", "Hamilton"), null), {
      level: 0,
      hint: null,
    });
  });
});

const item = (id: string, extra: Partial<ListeningItem> = {}): ListeningItem => ({
  id,
  title: `Album ${id}`,
  artist: "Someone",
  artwork: null,
  link: null,
  palette: [],
  durationMs: null,
  ...extra,
});

test("最近在听：没有基线不算播放", () => {
  assert.equal(listeningPlay(null, { items: [item("a")], fetchedAt: NOW }), null);
});

test("最近在听：只有封面地址或时长变了不算播放", () => {
  const previous = { items: [item("a"), item("b")], fetchedAt: NOW - 120_000 };
  assert.equal(
    listeningPlay(previous, {
      items: [item("a", { artwork: "https://signed/new", durationMs: 2_400_000 }), item("b")],
      fetchedAt: NOW,
    }),
    null,
  );
});

test("最近在听：新专辑进列表 → 一次痕迹，hint 是新的那张", () => {
  assert.deepEqual(
    listeningPlay(
      { items: [item("a")], fetchedAt: NOW - 120_000 },
      { items: [item("b", { title: "Hamilton" }), item("a")], fetchedAt: NOW },
    ),
    { t: NOW, since: NOW - 120_000, hint: "Someone – Hamilton" },
  );
});

test("最近在听：老专辑被重放顶到最前 → 仍是一次痕迹", () => {
  const play = listeningPlay(
    { items: [item("a"), item("b")], fetchedAt: NOW - 120_000 },
    { items: [item("b"), item("a")], fetchedAt: NOW },
  );
  assert.equal(play?.hint, "Someone – Album b");
});

test("最近在听：一次痕迹最多认一个评分窗口，口子再大也不多算", () => {
  const play = { t: NOW, since: NOW - 6 * 3_600_000, hint: null };
  const window = { from: NOW - CODING_WINDOW_MS, to: NOW };
  assert.deepEqual(listeningPlayCoverage(play, window), { from: NOW - CODING_WINDOW_MS, to: NOW });
  // 更早的窗口落在认领区间之外：口子虽然跨着它，也不算已观测。
  assert.equal(
    listeningPlayCoverage(play, { from: NOW - 4 * CODING_WINDOW_MS, to: NOW - 3 * CODING_WINDOW_MS }),
    null,
  );
});

test("最近在听：坏行丢掉，since 不早于 t 的也丢掉", () => {
  assert.equal(parseListeningPlay("{"), null);
  assert.equal(parseListeningPlay(JSON.stringify({ t: NOW, since: NOW, hint: null })), null);
  assert.deepEqual(parseListeningPlay(JSON.stringify({ t: NOW, since: NOW - 1, hint: " x " })), {
    t: NOW,
    since: NOW - 1,
    hint: "x",
  });
});

test("覆盖区间合并后有序不重叠，评估才不会被解析丢掉", () => {
  assert.deepEqual(
    mergeCoverage([
      { from: 30, to: 40 },
      { from: 0, to: 10 },
      { from: 5, to: 35 },
      { from: 50, to: 50 },
    ]),
    [{ from: 0, to: 40 }],
  );
});
