import { AwaitingReport } from "@/lib/api";
import { number, object, text } from "@/lib/json";
import {
  fanout,
  NOW_PLAYING_TAG,
  PLAYING_TAG,
  TROPHIES_TAG,
  type PendingEvent,
} from "@/lib/live-events";
import {
  getPlaystationPlayedGames,
  getPlaystationPresence,
  getPlaystationTrophies,
  setPlaystationPlayedGames,
  setPlaystationPresence,
  setPlaystationTrophies,
} from "@/lib/playstation-store";
import { normalizeTrophies, trophiesContent } from "@/lib/trophies";
import type {
  PlaystationGame,
  PlaystationNowPlaying,
  PlaystationPlayingPayload,
  PlaystationPresencePayload,
} from "@/lib/types";

function requiredNumber(
  row: Record<string, unknown>,
  field: string,
  context: string,
): number {
  const value = number(row[field]);
  if (value == null || value < 0) {
    throw new Error(`${context} 的 ${field} 必须是非负数字`);
  }
  return value;
}

function requiredText(
  row: Record<string, unknown>,
  field: string,
  context: string,
): string {
  const value = text(row[field]);
  if (!value) throw new Error(`${context} 的 ${field} 必须是非空字符串`);
  return value;
}

function nullableNumber(
  row: Record<string, unknown>,
  field: string,
  context: string,
): number | null {
  if (!(field in row)) throw new Error(`${context} 缺少 ${field}`);
  if (row[field] == null) return null;
  return requiredNumber(row, field, context);
}

function nullableText(
  row: Record<string, unknown>,
  field: string,
  context: string,
): string | null {
  if (!(field in row)) throw new Error(`${context} 缺少 ${field}`);
  if (row[field] == null) return null;
  return requiredText(row, field, context);
}

function requiredBoolean(
  row: Record<string, unknown>,
  field: string,
  context: string,
): boolean {
  const value = row[field];
  if (typeof value !== "boolean") {
    throw new Error(`${context} 的 ${field} 必须是布尔值`);
  }
  return value;
}

function normalizeNowPlaying(value: unknown): PlaystationNowPlaying | null {
  if (value == null) return null;
  const row = object(value);
  if (!row) throw new Error("PlayStation presence.playing 必须是对象或 null");
  return {
    titleId: requiredText(row, "titleId", "PlayStation presence.playing"),
    title: requiredText(row, "title", "PlayStation presence.playing"),
    format: nullableText(row, "format", "PlayStation presence.playing"),
    launchPlatform: nullableText(row, "launchPlatform", "PlayStation presence.playing"),
    iconUrl: nullableText(row, "iconUrl", "PlayStation presence.playing"),
  };
}

export function normalizePlaystationPresence(value: unknown): PlaystationPresencePayload {
  const row = object(value);
  if (!row) throw new Error("PlayStation presence 必须是对象");
  if (typeof row.online !== "boolean") {
    throw new Error("PlayStation presence 的 online 必须是布尔值");
  }
  if (!("playing" in row)) throw new Error("PlayStation presence 缺少 playing");

  return {
    observedAt: requiredNumber(row, "observedAt", "PlayStation presence"),
    online: row.online,
    availability: nullableText(row, "availability", "PlayStation presence"),
    platform: nullableText(row, "platform", "PlayStation presence"),
    lastOnlineAt: nullableNumber(row, "lastOnlineAt", "PlayStation presence"),
    playing: normalizeNowPlaying(row.playing),
  };
}

function normalizeGame(value: unknown, index: number): PlaystationGame {
  const row = object(value);
  const context = `PlayStation playedGames.items[${index}]`;
  if (!row) throw new Error(`${context} 必须是对象`);

  return {
    titleId: requiredText(row, "titleId", context),
    name: requiredText(row, "name", context),
    category: nullableText(row, "category", context),
    playCount: requiredNumber(row, "playCount", context),
    firstPlayedAt: nullableNumber(row, "firstPlayedAt", context),
    lastPlayedAt: nullableNumber(row, "lastPlayedAt", context),
    playDurationMs: nullableNumber(row, "playDurationMs", context),
    imageUrl: nullableText(row, "imageUrl", context),
    service: nullableText(row, "service", context),
    preOrder: requiredBoolean(row, "preOrder", context),
  };
}

export function normalizePlaystationPlayedGames(value: unknown): PlaystationPlayingPayload {
  const row = object(value);
  if (!row) throw new Error("PlayStation playedGames 必须是对象");
  if (!Array.isArray(row.items)) {
    throw new Error("PlayStation playedGames.items 必须是数组");
  }
  return {
    observedAt: requiredNumber(row, "observedAt", "PlayStation playedGames"),
    items: row.items.map(normalizeGame),
  };
}

/** observedAt 是采集时刻，不参与“内容有没有变化”的判断。 */
function presenceContent(payload: PlaystationPresencePayload) {
  return {
    online: payload.online,
    availability: payload.availability,
    platform: payload.platform,
    lastOnlineAt: payload.lastOnlineAt,
    playing: payload.playing,
  };
}

export async function getPlaying(): Promise<PlaystationPlayingPayload> {
  const payload = await getPlaystationPlayedGames();
  if (!payload) throw new AwaitingReport("尚未收到 PlayStation 最近游玩遥测");
  return payload;
}

export async function getPlayingNow(): Promise<PlaystationPresencePayload> {
  const payload = await getPlaystationPresence();
  if (!payload) throw new AwaitingReport("尚未收到 PlayStation 在线状态遥测");
  return payload;
}

/**
 * 三部分各自可省；缺席表示这次不谈这一项。站点再比一次内容，避免重试或手工
 * 兜底上报退化成广播。写、带数据推送与 tag 失效统一交给 fanout 排序。
 *
 * 奖杯目录只失效、不推：整份几百 KB，解锁又不是按秒翻的事。
 */
export async function recordPlaystationReport(input: unknown) {
  const envelope = object(input);
  if (!envelope || envelope.version !== 1) {
    throw new Error("PlayStation 遥测协议 version 必须为 1");
  }

  const incomingPresence =
    "presence" in envelope ? normalizePlaystationPresence(envelope.presence) : null;
  const incomingPlayedGames =
    "playedGames" in envelope
      ? normalizePlaystationPlayedGames(envelope.playedGames)
      : null;
  const incomingTrophies =
    "trophies" in envelope ? normalizeTrophies(envelope.trophies) : null;

  const [previousPresence, previousPlayedGames, previousTrophies] = await Promise.all([
    incomingPresence ? getPlaystationPresence() : null,
    incomingPlayedGames ? getPlaystationPlayedGames() : null,
    incomingTrophies ? getPlaystationTrophies() : null,
  ]);

  const presenceChanged =
    incomingPresence != null &&
    (!previousPresence ||
      JSON.stringify(presenceContent(previousPresence)) !==
        JSON.stringify(presenceContent(incomingPresence)));
  const playedGamesChanged =
    incomingPlayedGames != null &&
    JSON.stringify(previousPlayedGames?.items ?? null) !==
      JSON.stringify(incomingPlayedGames.items);
  const trophiesChanged =
    incomingTrophies != null &&
    JSON.stringify(previousTrophies ? trophiesContent(previousTrophies) : null) !==
      JSON.stringify(trophiesContent(incomingTrophies));

  const writes: Promise<unknown>[] = [];
  const events: PendingEvent[] = [];
  const tags: string[] = [];

  const urgentTags: string[] = [];
  if (incomingPresence && (presenceChanged || !previousPresence)) {
    writes.push(setPlaystationPresence(incomingPresence));
    events.push({ type: "playing-now", payload: incomingPresence });
    // 「正在游玩」和听歌 now 一样：不能先把旧值再顶几分钟。
    urgentTags.push(NOW_PLAYING_TAG);
  }
  if (incomingPlayedGames && (playedGamesChanged || !previousPlayedGames)) {
    writes.push(setPlaystationPlayedGames(incomingPlayedGames));
    events.push({ type: "playing", payload: incomingPlayedGames });
    urgentTags.push(PLAYING_TAG);
    // 奖杯目录的时长和 Plus / 预购是读时按 titleIds 盖上去的，游玩一变就得重算。
    tags.push(TROPHIES_TAG);
  }
  if (incomingTrophies && (trophiesChanged || !previousTrophies)) {
    writes.push(setPlaystationTrophies(incomingTrophies));
    // 目录是整份替换：旧标题必须立刻从 status 里消失，不能再 SWR 几分钟。
    urgentTags.push(TROPHIES_TAG);
  }

  await fanout({ writes, events, tags, urgentTags });
  return { changed: presenceChanged || playedGamesChanged || trophiesChanged };
}
