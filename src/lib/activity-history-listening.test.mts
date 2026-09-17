import assert from "node:assert/strict";
import test from "node:test";

import { listeningLevel } from "@shared/activity-history-levels";
import { withRequestState } from "@shared/request-state";
import { bareSnapshotFrom, telemetryState } from "@shared/telemetry";
import { MUSIC_PAUSE_GRACE_MS, pickNowListening } from "@/lib/now-listening";
import type { Liveness } from "@/lib/reporter-liveness";
import type { LocalNowPlaying } from "@/lib/types";
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
