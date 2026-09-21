import { key } from "@/lib/storage";
import type {
  ChargerStatus,
  ListeningItem,
  LocalNowPlaying,
  PlaystationGame,
  PlaystationPresencePayload,
  PowerBankStatus,
  ServerStatus,
  TimezoneActivity,
  TrophiesPayload,
  WatchingMedia,
} from "@/lib/types";
import type { ParsedVibeCodingUsage } from "@/lib/vibecoding-parse";
import type { StoredAgentLimits } from "@/lib/vibecoding-limits";
import { displayChanged } from "@shared/display-change";

/**
 * 展示状态的变更存档。
 *
 * 快照键只留最新一份，pulse 阶跃序列只管六域活动曲线。两边都盖不住的那些
 * 变化（切了前台应用、换了歌、解锁了一枚奖杯）记在这里：一条就是变化之后的
 * 状态，时钟和纯心跳不进比较，所以同一状态重试不会再写一条。
 */
export const JOURNAL_SUBJECTS = [
  "desktop",
  "timezone",
  "listening-mac",
  "listening-homepod",
  "listening",
  "watching-now",
  "watching",
  "playing-now",
  "playstation-power",
  "playing",
  "trophies",
  "charger",
  "powerbank",
  "server",
  "vibecoding",
  "vibecoding-usage",
  "vibecoding-year",
  "agent-limits",
  "workouts",
  "activity",
] as const;

export type JournalSubject = (typeof JOURNAL_SUBJECTS)[number];

/** 热数据上限。最密的服务器快照约一分钟一条，这些条够 cron 停两天还能补进 D1。 */
export const JOURNAL_LIMIT = 4000;
export const JOURNAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** 单条状态 JSON 的上限。再大就只留摘要，避免一条奖杯目录或年图撑爆 D1 行。 */
const STATE_JSON_MAX = 48_000;
const RECENT_TROPHIES = 40;

export type JournalEntry = {
  /** 该 subject 内单调，水位线和主键用它。时钟回拨时会比 `at` 大 1。 */
  t: number;
  /** 观测时刻，允许和上一笔相同；不参与「变没变」。 */
  at: number;
  state: unknown;
};

export function journalKey(subject: JournalSubject): string {
  return key("journal", subject);
}

export function parseJournalEntry(raw: string): JournalEntry | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const row = value as { t?: unknown; at?: unknown; state?: unknown };
    if (!Number.isSafeInteger(row.t) || !Number.isSafeInteger(row.at) || !("state" in row)) return null;
    return { t: row.t as number, at: row.at as number, state: row.state };
  } catch {
    return null;
  }
}

function digest(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) hash = ((hash * 33) ^ value.charCodeAt(i)) >>> 0;
  return hash.toString(16);
}

function boundState(state: unknown): unknown {
  const encoded = JSON.stringify(state ?? null);
  if (encoded.length <= STATE_JSON_MAX) return state ?? null;
  return { truncated: true, bytes: encoded.length, digest: digest(encoded) };
}

/**
 * 该不该再追加一条。纯函数。
 *
 * 和上一笔展示状态相同（时钟字段不算）就丢掉。`at` 不前进时把 `t` 加 1，
 * 保证同一 subject 里主键不撞，重放时 `INSERT OR IGNORE` 仍然幂等。
 */
export function planJournalEntry(last: JournalEntry | null, at: number, state: unknown): JournalEntry | null {
  if (!Number.isSafeInteger(at)) return null;
  const stored = boundState(state);
  if (last && !displayChanged(last.state, stored)) return null;
  const t = last && at <= last.t ? last.t + 1 : at;
  return { t, at, state: stored };
}

export function desktopState(activity: {
  applicationName: string;
  bundleIdentifier: string | null;
  iconObjectKey: string | null;
} | null) {
  if (!activity) return { applicationName: null, bundleIdentifier: null, iconObjectKey: null };
  return {
    applicationName: activity.applicationName,
    bundleIdentifier: activity.bundleIdentifier,
    iconObjectKey: activity.iconObjectKey,
  };
}

export function timezoneState(timezone: TimezoneActivity | null) {
  if (!timezone) return { identifier: null, abbreviation: null, secondsFromGMT: null };
  return {
    identifier: timezone.identifier,
    abbreviation: timezone.abbreviation,
    secondsFromGMT: timezone.secondsFromGMT,
  };
}

export function listeningDeviceState(
  music: Pick<LocalNowPlaying, "source" | "state" | "title" | "artist" | "album" | "trackId" | "repeatOne"> | null,
  upcoming: { title: string; artist: string | null; album: string | null }[] = [],
) {
  if (!music) return { track: null, upcoming };
  return {
    source: music.source,
    state: music.state,
    trackId: music.trackId,
    title: music.title,
    artist: music.artist,
    album: music.album,
    repeatOne: music.repeatOne,
    upcoming,
  };
}

/** 封面地址和取色会自己换，不代表又听了一张。 */
export function listeningListState(items: ListeningItem[]) {
  return { items: items.map((item) => ({ id: item.id, title: item.title, artist: item.artist })) };
}

function compactMedia(media: WatchingMedia | null) {
  if (!media) return null;
  return {
    container: media.container,
    video: media.video
      ? { codec: media.video.codec, width: media.video.width, height: media.video.height, range: media.video.range }
      : null,
    audio: media.audio
      ? {
        codec: media.audio.codec,
        profile: media.audio.profile,
        channels: media.audio.channels,
        layout: media.audio.layout,
        language: media.audio.language,
      }
      : null,
    subtitle: media.subtitle ? { language: media.subtitle.language, title: media.subtitle.title } : null,
  };
}

export function watchingNowState(
  playing: {
    itemId: string;
    paused: boolean;
    client: string | null;
    deviceName: string | null;
    playMethod: string | null;
    media: WatchingMedia | null;
  } | null,
  item: { title: string; subtitle: string; type: string } | null,
) {
  if (!playing) return { playing: false };
  return {
    playing: true,
    itemId: playing.itemId,
    paused: playing.paused,
    client: playing.client,
    deviceName: playing.deviceName,
    playMethod: playing.playMethod,
    title: item?.title ?? null,
    subtitle: item?.subtitle ?? null,
    type: item?.type ?? null,
    media: compactMedia(playing.media),
  };
}

export function watchingListState(items: {
  id: string;
  title: string;
  subtitle: string;
  type: string;
  year: number | null;
  progress: number;
  playedAt: string | null;
}[]) {
  return {
    items: items.map((item) => ({
      id: item.id,
      title: item.title,
      subtitle: item.subtitle,
      type: item.type,
      year: item.year,
      progress: item.progress,
      playedAt: item.playedAt,
    })),
  };
}

export function playingNowState(presence: PlaystationPresencePayload) {
  const playing = presence.playing;
  return {
    online: presence.online,
    availability: presence.availability,
    platform: presence.platform,
    playing: playing
      ? { titleId: playing.titleId, title: playing.title, format: playing.format, launchPlatform: playing.launchPlatform }
      : null,
  };
}

export function playstationPowerState(power: { on: boolean; entityId: string | null }) {
  return { on: power.on, entityId: power.entityId };
}

export function playingListState(items: PlaystationGame[]) {
  return {
    items: items.map((game) => ({
      titleId: game.titleId,
      name: game.name,
      category: game.category,
      playCount: game.playCount,
      playDurationMs: game.playDurationMs,
      lastPlayedAt: game.lastPlayedAt,
      service: game.service,
      preOrder: game.preOrder,
    })),
  };
}

/**
 * 奖杯目录整份有几百 KB，存档只留能看懂变化的那一层：账号进度、每个游戏的
 * 枚数，以及最近解锁的 40 枚。具体哪一枚新解锁，前后两条一对就看出来。
 */
export function trophyArchiveState(payload: TrophiesPayload) {
  const unlocked = payload.titles.flatMap((title) => title.trophies.filter((trophy) => trophy.earned).map((trophy) => ({
    npCommunicationId: title.npCommunicationId,
    title: title.name,
    id: trophy.id,
    type: trophy.type,
    name: trophy.name,
    earnedAt: trophy.earnedAt,
  })));
  unlocked.sort((a, b) => (b.earnedAt ?? 0) - (a.earnedAt ?? 0) || a.npCommunicationId.localeCompare(b.npCommunicationId) || a.id - b.id);
  return {
    profile: {
      onlineId: payload.profile.onlineId,
      level: payload.profile.level,
      tier: payload.profile.tier,
      trophyPoint: payload.profile.trophyPoint,
      earned: payload.profile.earned,
    },
    titles: payload.titles.map((title) => ({
      npCommunicationId: title.npCommunicationId,
      name: title.name,
      progress: title.progress,
      defined: title.defined,
      earned: title.earned,
    })),
    recentUnlocked: unlocked.slice(0, RECENT_TROPHIES),
  };
}

/** 瓦数每帧都在跳，那是功率曲线的事。这里只留插拔、设备和「有没有在出力」。 */
export function chargerState(status: ChargerStatus) {
  return {
    connected: status.connected,
    drawing: status.totalPower > 1,
    device: {
      serialNumber: status.device.serialNumber,
      firmwareVersion: status.device.firmwareVersion,
      model: status.device.model,
    },
    ports: status.ports.map((port) => ({ id: port.id, active: port.active, device: port.device })),
    cover: status.cover ? { name: status.cover.name, iconHash: status.cover.iconHash } : null,
  };
}

export function powerBankState(status: PowerBankStatus) {
  return {
    connected: status.connected,
    charging: status.charging,
    thermalLimited: status.thermalLimited,
    battery: status.battery == null ? null : Math.round(status.battery),
    batteryHealth: status.batteryHealth,
    device: {
      serialNumber: status.device.serialNumber,
      firmwareVersion: status.device.firmwareVersion,
      model: status.device.model,
    },
    ports: status.ports.map((port) => ({
      id: port.id,
      active: port.active,
      direction: port.direction,
      attached: port.attached,
    })),
  };
}

export function serverState(status: ServerStatus) {
  const { observedAt, ...state } = status;
  void observedAt;
  return state;
}

export function vibeNowState(agents: { id: string; currentModel: string | null; active: boolean }[]) {
  return {
    agents: agents.map((agent) => ({ id: agent.id, currentModel: agent.currentModel, active: agent.active })),
  };
}

export function vibeUsageState(payload: ParsedVibeCodingUsage) {
  return {
    totals: payload.totals,
    topModels: payload.topModels,
    agents: payload.agents.map((agent) => ({
      id: agent.id,
      label: agent.label,
      icon: agent.icon,
      models: agent.models,
      currentModel: agent.currentModel,
      topModel: agent.topModel,
      today: agent.today,
      usageStatus: { state: agent.usageStatus.state, error: agent.usageStatus.error },
    })),
  };
}

export function vibeYearState(year: { origin: string; days: number[]; models: string[]; mix: number[][] }) {
  return { origin: year.origin, days: year.days, models: year.models, mix: year.mix };
}

/** 限额心跳只刷新到达时刻。百分比没变就不是一条新状态。 */
export function agentLimitsState(stored: StoredAgentLimits) {
  return {
    agents: Object.fromEntries(Object.entries(stored.agents).sort(([a], [b]) => a.localeCompare(b)).map(([id, row]) => [id, {
      plan: row.plan,
      limits: row.limits,
      limitsError: row.limitsError,
    }])),
  };
}
