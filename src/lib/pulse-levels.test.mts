import assert from "node:assert/strict";
import test from "node:test";

import {
  chargingLevel,
  codingLevel,
  compactHint,
  gamingLevel,
  isCodingApp,
  listeningLevel,
  watchingLevel,
} from "@shared/pulse-levels";
import type { EmbyNowPlaying, StoredWatchingItem } from "@shared/emby-store";
import { PULSE_HINT_MAX } from "@/lib/limits";
import type {
  ChargerStatus,
  NowListeningPayload,
  PlaystationPresencePayload,
  VibeCodingNowPayload,
} from "@/lib/types";

function listening(
  partial: Partial<NowListeningPayload> & Pick<NowListeningPayload, "idle" | "music">,
): NowListeningPayload {
  return {
    receivedAt: 1,
    id: null,
    link: null,
    songId: null,
    upcomingSongIds: [],
    hasLyrics: false,
    expiresInMs: null,
    ...partial,
  };
}

function music(state: NonNullable<NowListeningPayload["music"]>["state"], title: string | null, artist: string | null = null) {
  return {
    source: "apple-music" as const,
    state,
    title,
    artist,
    album: null,
    trackId: null,
    artworkUrl: null,
    positionMs: 0,
    durationMs: 0,
    repeatOne: false,
    observedAt: 1,
  };
}

function watchingItem(title: string): StoredWatchingItem {
  return {
    id: "1",
    title,
    subtitle: "",
    progress: 0,
    posterKey: null,
    backdropKey: null,
    type: "Movie",
    year: null,
    link: null,
    playedAt: null,
  };
}

function playingState(paused: boolean): EmbyNowPlaying {
  return {
    itemId: "1",
    paused,
    positionTicks: 0,
    runTimeTicks: 0,
    client: null,
    deviceName: null,
    playMethod: null,
    media: null,
    at: 1,
  };
}

function presence(partial: Partial<PlaystationPresencePayload> = {}): PlaystationPresencePayload {
  return {
    observedAt: 1,
    online: false,
    availability: null,
    platform: null,
    lastOnlineAt: null,
    playing: null,
    ...partial,
  };
}

function charger(partial: Partial<ChargerStatus> = {}): ChargerStatus {
  return {
    connected: true,
    totalPower: 0,
    maxPower: 160,
    ports: [],
    device: { serialNumber: null, firmwareVersion: null, model: "A2687" },
    cover: null,
    updatedAt: 1,
    ...partial,
  };
}

const agents = (
  rows: Array<Partial<VibeCodingNowPayload["agents"][number]> & Pick<VibeCodingNowPayload["agents"][number], "id" | "active">>,
): VibeCodingNowPayload["agents"] =>
  rows.map((row) => ({ currentModel: null, lastActivityAt: null, ...row }));

test("compactHint 拼得下就拼，拼不下退回最后一段并截到 48", () => {
  assert.equal(compactHint(null, "  ", undefined), null);
  assert.equal(compactHint("Artist", "Title"), "Artist – Title");
  const longTitle = "T".repeat(PULSE_HINT_MAX + 8);
  assert.equal(compactHint("A Very Long Artist Name Indeed", longTitle), "T".repeat(PULSE_HINT_MAX));
  assert.equal(compactHint(longTitle), "T".repeat(PULSE_HINT_MAX));
});

test("listeningLevel：空闲 / 播放 / 暂停 / 停掉，hint 优先 artist – title", () => {
  const rows: Array<{ name: string; payload: NowListeningPayload; level: number; hint: string | null }> = [
    { name: "idle", payload: listening({ idle: true, music: null }), level: 0, hint: null },
    { name: "no music", payload: listening({ idle: false, music: null }), level: 0, hint: null },
    {
      name: "playing",
      payload: listening({ idle: false, music: music("playing", "Helpless", "Hamilton") }),
      level: 3,
      hint: "Hamilton – Helpless",
    },
    {
      name: "paused",
      payload: listening({ idle: false, music: music("paused", "Helpless", "Hamilton") }),
      level: 2,
      hint: "Hamilton – Helpless",
    },
    {
      name: "stopped",
      payload: listening({ idle: false, music: music("stopped", "Helpless", "Hamilton") }),
      level: 0,
      hint: null,
    },
    {
      name: "title only",
      payload: listening({ idle: false, music: music("playing", "Helpless") }),
      level: 3,
      hint: "Helpless",
    },
    {
      name: "long pair falls back to title",
      payload: listening({
        idle: false,
        music: music("playing", "Short", "A".repeat(41)),
      }),
      level: 3,
      hint: "Short",
    },
  ];
  for (const row of rows) {
    assert.deepEqual(listeningLevel(row.payload), { level: row.level, hint: row.hint }, row.name);
  }
});

test("watchingLevel：无会话 0，暂停 2，在播 3；剧名来自 item.title", () => {
  assert.deepEqual(watchingLevel(null, null), { level: 0, hint: null });
  assert.deepEqual(watchingLevel(playingState(true), watchingItem("Gundam")), {
    level: 2,
    hint: "Gundam",
  });
  assert.deepEqual(watchingLevel(playingState(false), watchingItem("Gundam")), {
    level: 3,
    hint: "Gundam",
  });
  const long = "M".repeat(60);
  assert.equal(watchingLevel(playingState(false), watchingItem(long)).hint, "M".repeat(PULSE_HINT_MAX));
});

test("gamingLevel：在玩 3，在线 1，离线 0；hint 是游戏名", () => {
  assert.deepEqual(gamingLevel(presence()), { level: 0, hint: null });
  assert.deepEqual(gamingLevel(presence({ online: true })), { level: 1, hint: null });
  assert.deepEqual(
    gamingLevel(
      presence({
        online: true,
        playing: { titleId: "CUSA", title: "Astro Bot", format: null, launchPlatform: null, iconUrl: null },
      }),
    ),
    { level: 3, hint: "Astro Bot" },
  );
});

test("isCodingApp 认 bundle id、JetBrains 前缀和 overrides 里那套启发式", () => {
  const rows: Array<[string | null, string | null, boolean, string]> = [
    ["com.todesktop.230313mzl4w4u92", "Cursor", true, "Cursor ToDesktop id"],
    ["com.microsoft.VSCode", "Code", true, "VS Code"],
    ["com.apple.dt.Xcode", "Xcode", true, "Xcode"],
    ["dev.zed.Zed", "Zed", true, "Zed"],
    ["com.mitchellh.ghostty", "Ghostty", true, "Ghostty id"],
    ["com.apple.Terminal", "Terminal", true, "Terminal"],
    ["com.googlecode.iterm2", "iTerm2", true, "iTerm"],
    ["dev.warp.Warp-Stable", "Warp", true, "Warp"],
    ["com.jetbrains.intellij", "IntelliJ IDEA", true, "JetBrains prefix"],
    ["com.anthropic.claude-code", "Claude", true, "Anthropic / Claude"],
    ["something.antigravity.app", "Antigravity", true, "Antigravity includes"],
    ["com.apple.Safari", "Safari", false, "Safari is not coding"],
    [null, "Cursor", true, "name fallback"],
    [null, "Safari", false, "unknown name"],
  ];
  for (const [bundle, name, expected, label] of rows) {
    assert.equal(isCodingApp(bundle, name), expected, label);
  }
});

test("codingLevel：活跃 agent 优先于前台应用", () => {
  assert.deepEqual(
    codingLevel({
      agents: agents([{ id: "claude", active: true, currentModel: "opus" }]),
      desktop: { applicationName: "Safari", bundleIdentifier: "com.apple.Safari" },
    }),
    { level: 3, hint: "opus" },
  );
  assert.deepEqual(
    codingLevel({
      agents: agents([{ id: "codex", active: true, currentModel: null }]),
      desktop: null,
    }),
    { level: 3, hint: "codex" },
  );
  assert.deepEqual(
    codingLevel({
      agents: agents([{ id: "claude", active: false, currentModel: "opus" }]),
      desktop: { applicationName: "Cursor", bundleIdentifier: "com.todesktop.230313mzl4w4u92" },
    }),
    { level: 2, hint: "Cursor" },
  );
  assert.deepEqual(
    codingLevel({
      agents: null,
      desktop: { applicationName: "Safari", bundleIdentifier: "com.apple.Safari" },
    }),
    { level: 0, hint: null },
  );
});

test("chargingLevel：断联 0，功率分档，有口在输出也算低档", () => {
  assert.deepEqual(chargingLevel(charger({ connected: false, totalPower: 80 })), {
    level: 0,
    hint: null,
  });
  assert.deepEqual(chargingLevel(charger({ totalPower: 60, cover: { name: "Prime", iconHash: null, iconObjectKey: null, iconUrl: null } })), {
    level: 3,
    hint: "Prime",
  });
  assert.deepEqual(chargingLevel(charger({ totalPower: 15 })), { level: 2, hint: null });
  assert.deepEqual(chargingLevel(charger({ totalPower: 1.5 })), { level: 1, hint: null });
  assert.deepEqual(
    chargingLevel(
      charger({
        totalPower: 0,
        ports: [
          { id: "C1", active: false, power: null, voltage: null, current: null, device: "Phone", protocol: null, cable: null },
          { id: "C2", active: true, power: 0, voltage: null, current: null, device: "MacBook Pro", protocol: null, cable: null },
        ],
      }),
    ),
    { level: 1, hint: "MacBook Pro" },
  );
  assert.deepEqual(chargingLevel(charger({ totalPower: 0 })), { level: 0, hint: null });
});
