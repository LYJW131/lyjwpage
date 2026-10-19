import { getUserTrophiesForSpecificTitle, type UserTrophiesBySpecificTitleResponse } from "psn-api";

import { AuthSession } from "./auth.js";
import { type Env } from "./env.js";
import { type PlayedGame, type PlayedGamesReport } from "./psn.js";
import { type TrophiesReport, type TrophyTitleReport } from "./trophy-model.js";
import { assertNoPsnError, languageHeader, nonNegative, retryRateLimit, withToken, type Loose } from "./util.js";

const TITLE_ID_BATCH = 5;

function fold(
  a: number | null,
  b: number | null,
  by: (x: number, y: number) => number,
): number | null {
  if (a == null) return b;
  if (b == null) return a;
  return by(a, b);
}

function playStats(games: PlayedGame[] | undefined, trophyName: string) {
  const unique = [...new Map((games ?? []).map((game) => [game.titleId, game])).values()];
  const localizedName =
    unique.map((game) => game.name.trim()).find((name) => name && name !== trophyName) ?? null;
  return {
    titleIds: unique.map((game) => game.titleId),
    localizedName,
    playDurationMs: unique.reduce<number | null>(
      (sum, game) => fold(sum, game.playDurationMs, (x, y) => x + y),
      null,
    ),
    playCount: unique.reduce((sum, game) => sum + game.playCount, 0),
    firstPlayedAt: unique.reduce<number | null>(
      (min, game) => fold(min, game.firstPlayedAt, Math.min),
      null,
    ),
    lastPlayedAt: unique.reduce<number | null>(
      (max, game) => fold(max, game.lastPlayedAt, Math.max),
      null,
    ),
    service: unique.some((game) => game.service === "ps_plus")
      ? "ps_plus"
      : (unique.find((game) => game.service)?.service ?? null),
    preOrder: unique.some((game) => game.preOrder),
  };
}

async function requestTitleLinks(
  env: Env,
  auth: AuthSession,
  npTitleIds: string[],
): Promise<Array<{ npTitleId: string; npCommunicationIds: string[] }>> {
  const localized = languageHeader(env);
  const raw: Loose<UserTrophiesBySpecificTitleResponse> = assertNoPsnError(
    await withToken(auth, (token) =>
      getUserTrophiesForSpecificTitle({ accessToken: token }, "me", {
        npTitleIds: npTitleIds.join(","),
        ...(localized ? { headerOverrides: localized } : {}),
      }),
    ),
    "titleId 对齐",
  );
  return (raw.titles ?? []).map((row) => ({
    npTitleId: row.npTitleId ?? "",
    npCommunicationIds: (row.trophyTitles ?? [])
      .map((title) => title.npCommunicationId)
      .filter((id): id is string => Boolean(id)),
  }));
}

export function playLinkGames(played: PlayedGamesReport): PlayedGame[] {
  const games = played.items.filter(
    (game) => game.titleId && game.category?.endsWith("_media_app") !== true,
  );
  return [...new Map(games.map((game) => [game.titleId, game])).values()];
}

// 上游限制每批 TITLE_ID_BATCH 个；未同步奖杯的标题可使整批失败，需拆成单条重试。
export async function mapPlayByTrophy(
  env: Env,
  auth: AuthSession,
  games: PlayedGame[],
): Promise<Record<string, PlayedGame[]>> {
  const byTitleId = new Map(games.map((game) => [game.titleId, game]));
  const ids = games.map((game) => game.titleId);
  const byTrophy: Record<string, PlayedGame[]> = {};

  const apply = (npTitleId: string, npCommunicationIds: string[]) => {
    const game = byTitleId.get(npTitleId);
    if (!game) return;
    for (const id of npCommunicationIds) {
      const list = byTrophy[id] ?? [];
      if (!list.some((item) => item.titleId === game.titleId)) list.push(game);
      byTrophy[id] = list;
    }
  };

  async function mapChunk(chunk: string[]) {
    try {
      const rows = await retryRateLimit(() => requestTitleLinks(env, auth, chunk));
      for (const row of rows) apply(row.npTitleId, row.npCommunicationIds);
    } catch {
      if (chunk.length === 1) return;
      for (const id of chunk) await mapChunk([id]);
    }
  }

  for (let i = 0; i < ids.length; i += TITLE_ID_BATCH) {
    await mapChunk(ids.slice(i, i + TITLE_ID_BATCH));
  }

  return byTrophy;
}

export function mergePlayByTrophy(
  base: Record<string, PlayedGame[]>,
  extra: Record<string, PlayedGame[]>,
): Record<string, PlayedGame[]> {
  const out: Record<string, PlayedGame[]> = { ...base };
  for (const [id, games] of Object.entries(extra)) {
    const prior = out[id];
    const list = prior ? [...prior] : [];
    for (const game of games) {
      if (!list.some((item) => item.titleId === game.titleId)) list.push(game);
    }
    out[id] = list;
  }
  return out;
}

export function playByTrophyFromTitles(
  titles: TrophyTitleReport[],
  games: PlayedGame[],
): Record<string, PlayedGame[]> {
  const byTitleId = new Map(games.map((game) => [game.titleId, game]));
  const out: Record<string, PlayedGame[]> = {};
  for (const title of titles) {
    const list: PlayedGame[] = [];
    for (const id of title.titleIds) {
      const game = byTitleId.get(id);
      if (game && !list.some((item) => item.titleId === game.titleId)) list.push(game);
    }
    if (list.length) out[title.npCommunicationId] = list;
  }
  return out;
}

export function applyPlayStats(
  titles: TrophiesReport["titles"],
  byTrophy: Record<string, PlayedGame[]>,
): TrophiesReport["titles"] {
  return titles.map((title) => {
    const games = byTrophy[title.npCommunicationId];
    if (!games?.length) return title;
    const play = playStats(games, title.name);
    return {
      ...title,
      localizedName: play.localizedName,
      titleIds: play.titleIds,
      playDurationMs: play.playDurationMs,
      playCount: nonNegative(play.playCount),
      firstPlayedAt: play.firstPlayedAt,
      lastPlayedAt: play.lastPlayedAt,
      service: play.service,
      preOrder: play.preOrder,
    };
  });
}
