import { objectKeyFromAssetUrl } from "@shared/asset-url";
import type { NowWatchingPayload } from "@shared/emby";
import { isStale, liveNowListening, PLAYSTATION_STALE_MS } from "@shared/freshness";
import { LISTENING_ELSEWHERE_HOLD_MS } from "@shared/limits";
import { QUEST_STALE_MS, type QuestNow } from "@shared/quest";
import type {
  CodingNowPayload,
  NowListeningPayload,
  PlaystationPresencePayload,
} from "@shared/types";

export type LiveActivityKind = "watching" | "gaming" | "coding" | "listening" | "idle";

export type LiveActivity = {
  kind: LiveActivityKind;
  title: string | null;
  subtitle: string | null;
  artworkKey: string | null;
  alsoListening: { title: string; artist: string | null } | null;
  lastActiveAt: number | null;
};

export type LiveActivityInput = {
  nowListening: NowListeningPayload | null;
  nowWatching: NowWatchingPayload | null;
  playingNow: PlaystationPresencePayload | null;
  questNow: QuestNow | null;
  codingNow: CodingNowPayload | null;
};

// README 卡按分钟级缓存出图、粒度只到「在写代码」：取 15 分钟盖住 agent 回合之间的安静段，比站点卡的 5 分钟判活有意放宽。
export const CODING_ACTIVE_WINDOW_MS = 15 * 60_000;

// 显示名抄自 src/lib/coding-agents.ts#CODING_AGENTS（站点侧，Worker 不可 import）；没登记的 id 原样显示。
const CODING_AGENT_LABELS: Record<string, string> = {
  claude: "Claude Code",
  cursor: "Cursor",
  codex: "Codex",
  grok: "Grok Build",
  antigravity: "Antigravity",
  opencode: "OpenCode",
  pi: "Pi",
  devin: "Devin CLI",
};

type Picked = {
  title: string | null;
  subtitle: string | null;
  artworkKey: string | null;
  lastActiveAt: number | null;
};

type ListeningTrack = { title: string; artist: string | null; artworkKey: string | null; at: number };

type CodingActivityEntry = CodingNowPayload["agents"][number]["activity"][number];

function assetKey(url: string | null | undefined): string | null {
  return url ? objectKeyFromAssetUrl(url) : null;
}

function playedAtMs(item: { playedAt: string | null } | null | undefined): number | null {
  const at = item?.playedAt ? Date.parse(item.playedAt) : NaN;
  return Number.isFinite(at) ? at : null;
}

function listeningTrack(payload: NowListeningPayload | null, now: number): ListeningTrack | null {
  if (!payload) return null;
  const macOffline = isStale({
    now,
    at: payload.lastSeenAt,
    windowMs: payload.heartbeatWindowMs,
    declaredOffline: payload.declaredOffline,
  });
  const live = liveNowListening(payload, macOffline);
  const music = live.music?.state === "playing" ? live.music : null;
  if (music?.title) {
    return { title: music.title, artist: music.artist, artworkKey: assetKey(music.artworkUrl), at: music.observedAt };
  }
  const elsewhere = live.elsewhere;
  if (elsewhere && now < elsewhere.startedAt + elsewhere.durationMs + LISTENING_ELSEWHERE_HOLD_MS) {
    return { title: elsewhere.title, artist: elsewhere.artist, artworkKey: assetKey(elsewhere.artworkUrl), at: elsewhere.startedAt };
  }
  return null;
}

function watchingActivity(payload: NowWatchingPayload | null): Picked | null {
  const live = payload?.nowPlaying;
  if (!live || live.paused) return null;
  const item = payload.current;
  return {
    title: item?.title ?? null,
    subtitle: item?.subtitle || null,
    artworkKey: assetKey(item?.poster) ?? assetKey(item?.backdrop),
    lastActiveAt: playedAtMs(item),
  };
}

function gamingActivity(
  playstation: PlaystationPresencePayload | null,
  quest: QuestNow | null,
  now: number,
): Picked | null {
  // 同游戏道的约定：Quest 在玩期间盖住 PlayStation。
  if (quest?.available && quest.playing && now - Math.min(quest.observedAt, quest.receivedAt) < QUEST_STALE_MS) {
    return {
      title: quest.playing.name,
      subtitle: "Meta Quest",
      artworkKey: assetKey(quest.playing.largeImageUrl),
      lastActiveAt: quest.playing.startedAt ?? quest.observedAt,
    };
  }
  if (playstation?.playing && !isStale({ now, at: playstation.observedAt, windowMs: PLAYSTATION_STALE_MS })) {
    return {
      title: playstation.playing.title,
      subtitle: playstation.platform ?? playstation.playing.launchPlatform,
      artworkKey: assetKey(playstation.playing.iconUrl),
      lastActiveAt: playstation.observedAt,
    };
  }
  return null;
}

function codingActivity(payload: CodingNowPayload | null, now: number): Picked | null {
  if (!payload) return null;
  const active: { id: string; entry: CodingActivityEntry }[] = [];
  for (const agent of payload.agents) {
    let latest: CodingActivityEntry | null = null;
    for (const entry of agent.activity) {
      if (payload.declaredOffline && entry.source === "mac") continue;
      if (now - entry.lastActivityAt > CODING_ACTIVE_WINDOW_MS) continue;
      if (!latest || entry.lastActivityAt > latest.lastActivityAt) latest = entry;
    }
    if (latest) active.push({ id: agent.id, entry: latest });
  }
  const winner = active.sort((a, b) => b.entry.lastActivityAt - a.entry.lastActivityAt)[0];
  if (!winner) return null;
  const extra = active.length - 1;
  return {
    title: CODING_AGENT_LABELS[winner.id] ?? winner.id,
    subtitle: [winner.entry.model, extra ? `+${extra}` : null].filter(Boolean).join(" · ") || null,
    artworkKey: null,
    lastActiveAt: winner.entry.lastActivityAt,
  };
}

function lastActiveAt(input: LiveActivityInput, now: number): number | null {
  const candidates: number[] = [];
  const playedAt = playedAtMs(input.nowWatching?.current);
  if (playedAt) candidates.push(playedAt);
  const playstation = input.playingNow;
  if (playstation) candidates.push(playstation.lastOnlineAt ?? playstation.observedAt);
  const quest = input.questNow;
  if (quest) candidates.push(Math.max(quest.observedAt, quest.receivedAt));
  for (const agent of input.codingNow?.agents ?? []) {
    for (const entry of agent.activity) candidates.push(entry.lastActivityAt);
  }
  const music = input.nowListening?.music;
  if (music) candidates.push(music.observedAt);
  const elsewhere = input.nowListening?.elsewhere;
  if (elsewhere) candidates.push(Math.min(now, elsewhere.startedAt + elsewhere.durationMs));
  const valid = candidates.filter((at) => at > 0);
  return valid.length ? Math.max(...valid) : null;
}

export function pickLiveActivity(input: LiveActivityInput, now: number): LiveActivity {
  const track = listeningTrack(input.nowListening, now);
  const alsoListening = track ? { title: track.title, artist: track.artist } : null;

  const watching = watchingActivity(input.nowWatching);
  if (watching) return { kind: "watching", ...watching, alsoListening };
  const gaming = gamingActivity(input.playingNow, input.questNow, now);
  if (gaming) return { kind: "gaming", ...gaming, alsoListening };
  const coding = codingActivity(input.codingNow, now);
  if (coding) return { kind: "coding", ...coding, alsoListening };
  if (track) {
    return {
      kind: "listening",
      title: track.title,
      subtitle: track.artist,
      artworkKey: track.artworkKey,
      alsoListening: null,
      lastActiveAt: track.at,
    };
  }
  return {
    kind: "idle",
    title: null,
    subtitle: null,
    artworkKey: null,
    alsoListening: null,
    lastActiveAt: lastActiveAt(input, now),
  };
}
