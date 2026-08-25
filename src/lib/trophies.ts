import { AwaitingReport } from "@/lib/api";
import { number, object, text } from "@/lib/json";
import {
  getPlaystationPlayedGames,
  getPlaystationTrophies,
} from "@/lib/playstation-store";
import { foldService } from "@/lib/playstation-entitlements";
import type { PlaystationGame } from "@/lib/types";
import { addTrophyCounts, countTrophies, emptyTrophyCounts } from "@/lib/trophy-counts";
import {
  TROPHY_TYPES,
  type TrophiesPayload,
  type TrophiesSummaryPayload,
  type Trophy,
  type TrophyCounts,
  type TrophyGroup,
  type TrophyProfile,
  type TrophyTitle,
  type TrophyTitleDigest,
  type TrophyType,
  type TrophyUnlock,
} from "@/lib/types";

const TROPHY_TYPE_SET = new Set<string>(TROPHY_TYPES);

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

function httpsUrl(value: string | null): string | null {
  return value ? value.replace(/^http:\/\//i, "https://") : null;
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

function normalizeCounts(value: unknown, context: string): TrophyCounts {
  const row = object(value);
  if (!row) throw new Error(`${context} 必须是对象`);
  return {
    platinum: requiredNumber(row, "platinum", context),
    gold: requiredNumber(row, "gold", context),
    silver: requiredNumber(row, "silver", context),
    bronze: requiredNumber(row, "bronze", context),
  };
}

function normalizeProfile(value: unknown): TrophyProfile {
  const row = object(value);
  if (!row) throw new Error("PlayStation trophies.profile 必须是对象");
  const levelProgress = requiredNumber(row, "levelProgress", "PlayStation trophies.profile");
  if (levelProgress > 100) {
    throw new Error("PlayStation trophies.profile 的 levelProgress 必须在 0–100");
  }
  return {
    onlineId: requiredText(row, "onlineId", "PlayStation trophies.profile"),
    avatarUrl: httpsUrl(nullableText(row, "avatarUrl", "PlayStation trophies.profile")),
    plus: requiredBoolean(row, "plus", "PlayStation trophies.profile"),
    level: requiredNumber(row, "level", "PlayStation trophies.profile"),
    tier: requiredNumber(row, "tier", "PlayStation trophies.profile"),
    trophyPoint: requiredNumber(row, "trophyPoint", "PlayStation trophies.profile"),
    levelBasePoint: requiredNumber(row, "levelBasePoint", "PlayStation trophies.profile"),
    levelNextPoint: requiredNumber(row, "levelNextPoint", "PlayStation trophies.profile"),
    levelProgress,
    earned: normalizeCounts(row.earned, "PlayStation trophies.profile.earned"),
  };
}

function normalizeGroup(value: unknown, index: number, titleId: string): TrophyGroup {
  const context = `PlayStation trophies.titles[${titleId}].groups[${index}]`;
  const row = object(value);
  if (!row) throw new Error(`${context} 必须是对象`);
  const progress = requiredNumber(row, "progress", context);
  if (progress > 100) throw new Error(`${context} 的 progress 必须在 0–100`);
  return {
    id: requiredText(row, "id", context),
    name: requiredText(row, "name", context),
    iconUrl: nullableText(row, "iconUrl", context),
    progress,
    defined: normalizeCounts(row.defined, `${context}.defined`),
    earned: normalizeCounts(row.earned, `${context}.earned`),
  };
}

function normalizeTrophyType(value: unknown, context: string): TrophyType {
  if (typeof value !== "string" || !TROPHY_TYPE_SET.has(value)) {
    throw new Error(`${context} 的 type 必须是 platinum / gold / silver / bronze`);
  }
  return value as TrophyType;
}

function normalizeTrophy(value: unknown, index: number, titleId: string): Trophy {
  const context = `PlayStation trophies.titles[${titleId}].trophies[${index}]`;
  const row = object(value);
  if (!row) throw new Error(`${context} 必须是对象`);
  const id = number(row.id);
  if (id == null || id < 0 || !Number.isInteger(id)) {
    throw new Error(`${context} 的 id 必须是非负整数`);
  }
  const earnedRate = nullableNumber(row, "earnedRate", context);
  if (earnedRate != null && earnedRate > 100) {
    throw new Error(`${context} 的 earnedRate 必须在 0–100`);
  }
  return {
    id,
    type: normalizeTrophyType(row.type, context),
    name: requiredText(row, "name", context),
    detail: nullableText(row, "detail", context),
    iconUrl: nullableText(row, "iconUrl", context),
    hidden: requiredBoolean(row, "hidden", context),
    groupId: requiredText(row, "groupId", context),
    earned: requiredBoolean(row, "earned", context),
    earnedAt: nullableNumber(row, "earnedAt", context),
    earnedRate,
  };
}

function normalizeTitleIds(value: unknown, context: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${context}.titleIds 必须是数组`);
  return value.map((item, index) => {
    const id = text(item);
    if (!id) throw new Error(`${context}.titleIds[${index}] 必须是非空字符串`);
    return id;
  });
}

function normalizeTitle(value: unknown, index: number): TrophyTitle {
  const row = object(value);
  const context = `PlayStation trophies.titles[${index}]`;
  if (!row) throw new Error(`${context} 必须是对象`);
  const npCommunicationId = requiredText(row, "npCommunicationId", context);
  const progress = requiredNumber(row, "progress", context);
  if (progress > 100) throw new Error(`${context} 的 progress 必须在 0–100`);
  if (!Array.isArray(row.groups)) throw new Error(`${context}.groups 必须是数组`);
  if (!Array.isArray(row.trophies)) throw new Error(`${context}.trophies 必须是数组`);
  return {
    npCommunicationId,
    name: requiredText(row, "name", context),
    localizedName: nullableText(row, "localizedName", context),
    titleIds: normalizeTitleIds(row.titleIds, context),
    iconUrl: nullableText(row, "iconUrl", context),
    platform: requiredText(row, "platform", context),
    progress,
    defined: normalizeCounts(row.defined, `${context}.defined`),
    earned: normalizeCounts(row.earned, `${context}.earned`),
    lastUpdatedAt: nullableNumber(row, "lastUpdatedAt", context),
    playDurationMs: nullableNumber(row, "playDurationMs", context),
    playCount: requiredNumber(row, "playCount", context),
    firstPlayedAt: nullableNumber(row, "firstPlayedAt", context),
    lastPlayedAt: nullableNumber(row, "lastPlayedAt", context),
    service: nullableText(row, "service", context),
    preOrder: requiredBoolean(row, "preOrder", context),
    groups: row.groups.map((group, groupIndex) =>
      normalizeGroup(group, groupIndex, npCommunicationId),
    ),
    trophies: row.trophies.map((trophy, trophyIndex) =>
      normalizeTrophy(trophy, trophyIndex, npCommunicationId),
    ),
  };
}

export function normalizeTrophies(value: unknown): TrophiesPayload {
  const row = object(value);
  if (!row) throw new Error("PlayStation trophies 必须是对象");
  if (!Array.isArray(row.titles)) {
    throw new Error("PlayStation trophies.titles 必须是数组");
  }
  return {
    observedAt: requiredNumber(row, "observedAt", "PlayStation trophies"),
    profile: normalizeProfile(row.profile),
    titles: row.titles.map(normalizeTitle),
  };
}

/** observedAt 和游玩时长覆盖都不参与「奖杯内容有没有变」。 */
export function trophiesContent(payload: TrophiesPayload) {
  return {
    profile: payload.profile,
    titles: payload.titles.map((title) => ({
      npCommunicationId: title.npCommunicationId,
      name: title.name,
      localizedName: title.localizedName,
      titleIds: title.titleIds,
      iconUrl: title.iconUrl,
      platform: title.platform,
      progress: title.progress,
      defined: title.defined,
      earned: title.earned,
      lastUpdatedAt: title.lastUpdatedAt,
      groups: title.groups,
      trophies: title.trophies,
    })),
  };
}

function fold(
  a: number | null,
  b: number | null,
  by: (x: number, y: number) => number,
): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return by(a, b);
}

function playName(games: PlaystationGame[], trophyName: string): string | null {
  for (const game of games) {
    const name = game.name.trim();
    if (name && name !== trophyName) return name;
  }
  return null;
}

function entitlementsFrom(games: PlaystationGame[]): Pick<TrophyTitle, "service" | "preOrder"> {
  return {
    service: foldService(...games.map((game) => game.service)),
    preOrder: games.some((game) => game.preOrder),
  };
}

/**
 * 奖杯标题的键是 NPWR…，游玩列表是 PPSA…。Worker 已经用官方
 * titleId 对齐过，这里只按 `titleIds` 把多条 SKU 的时长加总。
 * 最近列表只覆盖窗口里的游戏：缺一条 SKU 就沿用库里的数，避免把完整合计裁短。
 */
function overlayPlayStats(
  titles: TrophyTitle[],
  games: PlaystationGame[],
): TrophyTitle[] {
  if (!games.length) return titles;
  return titles.map((title) => {
    const ids = title.titleIds ?? [];
    if (!ids.length) {
      return { ...title, service: title.service ?? null, preOrder: title.preOrder === true };
    }
    const pool = ids
      .map((id) => games.find((game) => game.titleId === id))
      .filter((game): game is PlaystationGame => game != null);
    if (!pool.length) {
      return { ...title, service: title.service ?? null, preOrder: title.preOrder === true };
    }
    const localizedName = playName(pool, title.name) ?? title.localizedName;
    const entitlements = entitlementsFrom(pool);
    if (pool.length < ids.length) {
      return { ...title, localizedName, ...entitlements };
    }
    return {
      ...title,
      localizedName,
      playDurationMs: pool.reduce<number | null>(
        (sum, game) => fold(sum, game.playDurationMs, (x, y) => x + y),
        null,
      ),
      playCount: pool.reduce((sum, game) => sum + game.playCount, 0),
      firstPlayedAt: pool.reduce<number | null>(
        (min, game) => fold(min, game.firstPlayedAt, Math.min),
        null,
      ),
      lastPlayedAt: pool.reduce<number | null>(
        (max, game) => fold(max, game.lastPlayedAt, Math.max),
        null,
      ),
      ...entitlements,
    };
  });
}

export async function getTrophies(): Promise<TrophiesPayload> {
  const payload = await getPlaystationTrophies();
  if (!payload) throw new AwaitingReport("尚未收到 PlayStation 奖杯遥测");
  const played = await getPlaystationPlayedGames();
  if (!played?.items.length) {
    return {
      ...payload,
      titles: payload.titles.map((title) => ({
        ...title,
        service: title.service ?? null,
        preOrder: title.preOrder === true,
      })),
    };
  }
  return { ...payload, titles: overlayPlayStats(payload.titles, played.items) };
}

export function summarizeTrophies(payload: TrophiesPayload): TrophiesSummaryPayload {
  const defined = payload.titles.reduce(
    (sum, title) => addTrophyCounts(sum, title.defined),
    emptyTrophyCounts(),
  );
  const recent: TrophyUnlock[] = [];
  for (const title of payload.titles) {
    const titleName = title.localizedName ?? title.name;
    for (const trophy of title.trophies) {
      if (!trophy.earned || trophy.earnedAt == null) continue;
      recent.push({
        npCommunicationId: title.npCommunicationId,
        titleName,
        trophyName: trophy.name,
        type: trophy.type,
        iconUrl: trophy.iconUrl,
        earnedAt: trophy.earnedAt,
      });
    }
  }
  recent.sort((a, b) => b.earnedAt - a.earnedAt);
  const titles: TrophyTitleDigest[] = payload.titles.map((title) => ({
    npCommunicationId: title.npCommunicationId,
    name: title.name,
    localizedName: title.localizedName,
    titleIds: title.titleIds,
    progress: title.progress,
    defined: title.defined,
    earned: title.earned,
  }));
  return {
    observedAt: payload.observedAt,
    profile: payload.profile,
    defined,
    titleCount: payload.titles.length,
    earnedCount: countTrophies(payload.profile.earned),
    recent: recent.slice(0, 3),
    titles,
  };
}

export async function getTrophiesSummary(): Promise<TrophiesSummaryPayload> {
  return summarizeTrophies(await getTrophies());
}
