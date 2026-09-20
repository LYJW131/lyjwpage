import { watchingIdentity } from "@/lib/watching";
import { site } from "@/lib/site";
import { workoutDuration, workoutMetrics } from "@/lib/workout-display";
import type { WatchingPayload, NowWatchingPayload } from "@/lib/emby";
import type {
  DesktopPayload,
  NowListeningPayload,
  PlaystationPlayingPayload,
  PlaystationPresencePayload,
  TrophiesSummaryPayload,
  TrophyType,
  VibeCodingPayload,
  WorkoutsPayload,
} from "@/lib/types";

/**
 * 首页时间线：把已经公开的 list / now 状态收成一条按时间排的记录。
 *
 * 不另开存储、不另开 `/api/status/timeline`。各路仍走原来的信封；这里只做
 * 展示层聚合。缺时间戳的条目直接丢掉 —— Apple Music `/v1/me/recent/played`
 * 不给单条播放时刻，所以听只纳入 `listening/now`。落地节点、充电头、Pulse
 * 是连续读数或强度泳道，不是带标题的事件，不进这条。
 */

export const TIMELINE_SOURCES = [
  "listening",
  "watching",
  "playing",
  "trophy",
  "workout",
  "coding",
  "desktop",
] as const;

export type TimelineSource = (typeof TIMELINE_SOURCES)[number];

export const TIMELINE_SOURCE_LABEL: Record<TimelineSource, string> = {
  listening: "Listening",
  watching: "Watching",
  playing: "Playing",
  trophy: "Trophy",
  workout: "Workout",
  coding: "Coding",
  desktop: "Desktop",
};

/** 收齐之后按时间倒序切这么多条，避免奖杯目录把整页拉得很长。 */
export const TIMELINE_LIMIT = 48;

const TROPHY_LABEL: Record<TrophyType, string> = {
  platinum: "Platinum",
  gold: "Gold",
  silver: "Silver",
  bronze: "Bronze",
};

const dayKeyFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: site.timezone,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const dayLabelFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: site.timezone,
  weekday: "short",
  month: "short",
  day: "numeric",
});

const dayLabelWithYearFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: site.timezone,
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
});

const clockFormat = new Intl.DateTimeFormat("en-US", {
  timeZone: site.timezone,
  hour: "numeric",
  minute: "2-digit",
});

export type TimelineEvent = {
  id: string;
  source: TimelineSource;
  atMs: number;
  live: boolean;
  paused: boolean;
  title: string;
  summary: string | null;
  href: string | null;
  imageUrl: string | null;
};

export type TimelineDay = {
  key: string;
  label: string;
  events: TimelineEvent[];
};

export type TimelineInput = {
  nowListening?: NowListeningPayload | null;
  watching?: WatchingPayload | null;
  nowWatching?: NowWatchingPayload | null;
  playing?: PlaystationPlayingPayload | null;
  playingNow?: PlaystationPresencePayload | null;
  trophies?: TrophiesSummaryPayload | null;
  workouts?: WorkoutsPayload | null;
  vibeCoding?: VibeCodingPayload | null;
  desktop?: DesktopPayload | null;
};

/** ISO 字符串或 epoch 毫秒；解析失败或非正数都算没有。 */
export function parseTimelineTime(value: string | number | null | undefined): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : null;
  }
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** 站点时区的日历日，`YYYY-MM-DD`。 */
export function timelineDayKey(atMs: number, timeZone = site.timezone): string {
  const format = timeZone === site.timezone
    ? dayKeyFormat
    : new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
  return format.format(new Date(atMs));
}

export function formatTimelineClock(atMs: number): string {
  return clockFormat.format(new Date(atMs));
}

function shiftDayKey(key: string, days: number): string {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function dayLabel(key: string, nowMs: number): string {
  const sample = Date.parse(`${key}T12:00:00+08:00`);
  if (nowMs > 0) {
    const today = timelineDayKey(nowMs);
    if (key === today) return "Today";
    if (key === shiftDayKey(today, -1)) return "Yesterday";
  }
  const year = Number(key.slice(0, 4));
  const nowYear = nowMs > 0 ? Number(timelineDayKey(nowMs).slice(0, 4)) : year;
  return (year === nowYear ? dayLabelFormat : dayLabelWithYearFormat).format(new Date(sample));
}

function playSummary(durationMs: number | null, playCount: number): string {
  if (durationMs == null) {
    return playCount === 1 ? "1 play" : `${playCount.toLocaleString("en-US")} plays`;
  }
  const hours = durationMs / 3_600_000;
  if (hours >= 10) return `${Math.round(hours)} hrs played`;
  if (hours >= 1) return `${hours.toFixed(1).replace(/\.0$/, "")} hrs played`;
  return `${Math.max(1, Math.round(durationMs / 60_000))} min played`;
}

function push(
  events: TimelineEvent[],
  event: Omit<TimelineEvent, "paused"> & { paused?: boolean },
): void {
  if (!event.title.trim()) return;
  events.push({ paused: false, ...event });
}

/**
 * 正在发生的事没有自己的时刻时，用 `nowMs` 排到最前；首屏 `nowMs === 0`
 * 时用一个稳定的大数，避免 hydrate 前后列表长短对不上。
 */
function liveSortAt(observedAt: number | null, nowMs: number): number {
  if (observedAt != null) return observedAt;
  return nowMs > 0 ? nowMs : Number.MAX_SAFE_INTEGER;
}

export function buildTimeline(input: TimelineInput, nowMs: number): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  const music = input.nowListening && !input.nowListening.idle ? input.nowListening.music : null;
  if (music && (music.state === "playing" || music.state === "paused") && music.title) {
    const device = music.source === "homepod" ? "HomePod" : "Apple Music";
    push(events, {
      id: `listening:${music.trackId ?? music.title}`,
      source: "listening",
      atMs: liveSortAt(parseTimelineTime(music.observedAt), nowMs),
      live: true,
      paused: music.state === "paused",
      title: music.title,
      summary: [music.artist, music.album].filter(Boolean).join(" · ") || device,
      href: input.nowListening?.link ?? null,
      imageUrl: music.artworkUrl,
    });
  }

  const liveWatching = input.nowWatching?.current ?? null;
  const nowPlaying = input.nowWatching?.nowPlaying ?? null;
  const watchingLive = Boolean(liveWatching && nowPlaying);
  const liveWatchingKey = liveWatching ? watchingIdentity(liveWatching) : null;

  if (watchingLive && liveWatching) {
    push(events, {
      id: `watching:${liveWatchingKey}`,
      source: "watching",
      atMs: liveSortAt(parseTimelineTime(liveWatching.playedAt), nowMs),
      live: true,
      paused: Boolean(nowPlaying?.paused),
      title: liveWatching.title,
      summary: liveWatching.subtitle || (liveWatching.year != null ? String(liveWatching.year) : null),
      href: liveWatching.link,
      imageUrl: liveWatching.poster ?? liveWatching.backdrop,
    });
  }

  for (const item of input.watching?.items ?? []) {
    if (liveWatchingKey && watchingIdentity(item) === liveWatchingKey) continue;
    const atMs = parseTimelineTime(item.playedAt);
    if (atMs == null) continue;
    push(events, {
      id: `watching:${watchingIdentity(item)}`,
      source: "watching",
      atMs,
      live: false,
      title: item.title,
      summary: item.subtitle || (item.year != null ? String(item.year) : null),
      href: item.link,
      imageUrl: item.poster ?? item.backdrop,
    });
  }

  const liveGame = input.playingNow?.playing ?? null;
  if (liveGame) {
    push(events, {
      id: `playing:${liveGame.titleId}`,
      source: "playing",
      atMs: liveSortAt(parseTimelineTime(input.playingNow?.observedAt), nowMs),
      live: true,
      title: liveGame.title,
      summary: liveGame.launchPlatform ?? liveGame.format ?? "PlayStation",
      href: null,
      imageUrl: liveGame.iconUrl,
    });
  }

  for (const game of input.playing?.items ?? []) {
    if (liveGame && game.titleId === liveGame.titleId) continue;
    const atMs = parseTimelineTime(game.lastPlayedAt);
    if (atMs == null) continue;
    push(events, {
      id: `playing:${game.titleId}`,
      source: "playing",
      atMs,
      live: false,
      title: game.name,
      summary: playSummary(game.playDurationMs, game.playCount),
      href: null,
      imageUrl: game.imageUrl,
    });
  }

  for (const unlock of input.trophies?.recent ?? []) {
    const atMs = parseTimelineTime(unlock.earnedAt);
    if (atMs == null) continue;
    push(events, {
      id: `trophy:${unlock.npCommunicationId}:${unlock.id}`,
      source: "trophy",
      atMs,
      live: false,
      title: unlock.trophyName,
      summary: `${unlock.titleName} · ${TROPHY_LABEL[unlock.type]}`,
      href: null,
      imageUrl: unlock.iconUrl,
    });
  }

  for (const workout of input.workouts?.items ?? []) {
    const atMs = parseTimelineTime(workout.endedAt) ?? parseTimelineTime(workout.startedAt);
    if (atMs == null) continue;
    const metrics = workoutMetrics(workout)
      .map((row) => row.value)
      .join(" · ");
    push(events, {
      id: `workout:${workout.id}`,
      source: "workout",
      atMs,
      live: false,
      title: workout.activityType,
      summary: metrics || workoutDuration(workout.durationSeconds),
      href: null,
      imageUrl: null,
    });
  }

  for (const agent of input.vibeCoding?.agents ?? []) {
    const atMs = parseTimelineTime(agent.lastActivityAt);
    if (atMs == null) continue;
    push(events, {
      id: `coding:${agent.id}`,
      source: "coding",
      atMs: agent.active ? liveSortAt(atMs, nowMs) : atMs,
      live: agent.active,
      title: agent.label,
      summary: agent.currentModel ?? agent.topModel,
      href: null,
      imageUrl: null,
    });
  }

  const desk = input.desktop?.desktop;
  if (desk && !input.desktop?.offlineAtSource && desk.applicationName) {
    push(events, {
      id: `desktop:${desk.bundleIdentifier ?? desk.applicationName}`,
      source: "desktop",
      atMs: liveSortAt(parseTimelineTime(desk.observedAt), nowMs),
      live: true,
      title: desk.applicationName,
      summary: "Foreground app",
      href: null,
      imageUrl: desk.iconUrl,
    });
  }

  events.sort((left, right) => right.atMs - left.atMs || left.id.localeCompare(right.id));
  return events.slice(0, TIMELINE_LIMIT);
}

export function groupTimelineDays(events: TimelineEvent[], nowMs: number): TimelineDay[] {
  const live: TimelineEvent[] = [];
  const days: TimelineDay[] = [];
  const index = new Map<string, TimelineDay>();
  for (const event of events) {
    if (event.live) {
      live.push(event);
      continue;
    }
    const key = timelineDayKey(event.atMs);
    let day = index.get(key);
    if (!day) {
      day = { key, label: dayLabel(key, nowMs), events: [] };
      index.set(key, day);
      days.push(day);
    }
    day.events.push(event);
  }
  // 正在发生的事单独成组，不拿 atMs 算日历日：首屏 nowMs 为 0 时 live 的排序
  // 时刻可能是占位大数，进「今天」会在 hydrate 后跳一天。
  if (live.length) {
    return [{ key: "now", label: "Now", events: live }, ...days];
  }
  return days;
}

export function timelineSourceNames(events: TimelineEvent[]): string[] {
  const seen = new Set<TimelineSource>();
  const names: string[] = [];
  for (const event of events) {
    if (seen.has(event.source)) continue;
    seen.add(event.source);
    names.push(TIMELINE_SOURCE_LABEL[event.source]);
  }
  return names;
}
