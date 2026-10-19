import { foldService } from "@shared/playstation-entitlements";
import { addTrophyCounts, countTrophies, emptyTrophyCounts } from "@shared/trophy-counts";
import type {
  PlaystationGame,
  PlaystationPlayingPayload,
  PlaystationPresencePayload,
  TrophyTitleDigest,
} from "@shared/types";

export function mediaApp(category: string | null | undefined): boolean {
  return category?.endsWith("_media_app") === true;
}

export function playedFor(milliseconds: number): string {
  const hours = milliseconds / 3_600_000;
  if (hours >= 10) return `${Math.round(hours)} hrs`;
  if (hours >= 1) return `${hours.toFixed(1).replace(/\.0$/, "")} hrs`;
  return `${Math.max(1, Math.round(milliseconds / 60_000))} min`;
}

export function playTime(milliseconds: number | null, playCount: number): string {
  if (milliseconds == null) return `${playCount} ${playCount === 1 ? "play" : "plays"}`;
  return `${playedFor(milliseconds)} played`;
}

export type Tile = {
  titleId: string;
  titleIds: string[];
  name: string;
  imageUrl: string | null;
  subtitle: string;
  live: boolean;
  mediaApp: boolean;
  service: string | null;
  preOrder: boolean;
  platforms: string[];
  trophies: TrophyTitleDigest | null;
  playDurationMs: number | null;
};

function consolesFromCategory(category: string | null | undefined): string[] {
  if (!category) return [];
  if (category.startsWith("ps5")) return ["PS5"];
  if (category.startsWith("ps4")) return ["PS4"];
  return [];
}

function consolesFromPresence(...raw: Array<string | null | undefined>): string[] {
  const found = new Set<string>();
  for (const value of raw) {
    const upper = value?.toUpperCase() ?? "";
    if (upper.includes("PS5")) found.add("PS5");
    if (upper.includes("PS4")) found.add("PS4");
  }
  return ["PS4", "PS5"].filter((name) => found.has(name));
}

function foldConsoles(a: string[], b: string[]): string[] {
  const found = new Set([...a, ...b]);
  return ["PS4", "PS5"].filter((name) => found.has(name));
}

function digestFor(
  titleIds: string[],
  titles: TrophyTitleDigest[],
): TrophyTitleDigest | null {
  const matches = titles.filter((title) =>
    title.titleIds.some((id) => titleIds.includes(id)),
  );
  if (matches.length === 0) return null;
  if (matches.length === 1) return matches[0];
  const earned = matches.reduce(
    (sum, title) => addTrophyCounts(sum, title.earned),
    emptyTrophyCounts(),
  );
  const defined = matches.reduce(
    (sum, title) => addTrophyCounts(sum, title.defined),
    emptyTrophyCounts(),
  );
  const total = countTrophies(defined);
  return {
    npCommunicationId: matches[0].npCommunicationId,
    name: matches[0].name,
    localizedName: matches[0].localizedName,
    titleIds: matches.flatMap((title) => title.titleIds),
    progress: total > 0 ? Math.round((countTrophies(earned) / total) * 100) : 0,
    defined,
    earned,
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

// 合并同款 SKU 时保留全部 titleIds，presence 可能命中其中任意一个。
export type MergedGame = PlaystationGame & { titleIds: string[]; platforms: string[] };

export function mergeVariants(games: PlaystationGame[]): MergedGame[] {
  const merged: MergedGame[] = [];
  const byLook = new Map<string, MergedGame>();
  for (const game of games) {
    const look = `${game.name}\n${game.imageUrl ?? ""}`;
    const prior = byLook.get(look);
    if (!prior) {
      const entry: MergedGame = {
        ...game,
        titleIds: [game.titleId],
        platforms: consolesFromCategory(game.category),
        service: game.service ?? null,
        preOrder: game.preOrder === true,
      };
      byLook.set(look, entry);
      merged.push(entry);
      continue;
    }
    prior.titleIds.push(game.titleId);
    prior.playCount += game.playCount;
    prior.playDurationMs = fold(prior.playDurationMs, game.playDurationMs, (x, y) => x + y);
    prior.firstPlayedAt = fold(prior.firstPlayedAt, game.firstPlayedAt, Math.min);
    prior.lastPlayedAt = fold(prior.lastPlayedAt, game.lastPlayedAt, Math.max);
    prior.service = foldService(prior.service, game.service);
    prior.preOrder = prior.preOrder === true || game.preOrder === true;
    prior.platforms = foldConsoles(prior.platforms, consolesFromCategory(game.category));
  }
  return merged;
}

function tilePriority(tile: Tile): number {
  if (tile.live) return 0;
  if ((tile.trophies?.earned.platinum ?? 0) > 0) return 1;
  if (tile.preOrder) return 2;
  return 3;
}

function prioritizeTiles(tiles: Tile[]): Tile[] {
  return tiles
    .map((tile, index) => ({ tile, index }))
    .sort((a, b) => {
      const aRank = tilePriority(a.tile);
      const bRank = tilePriority(b.tile);
      if (aRank !== bRank) return aRank - bRank;
      if (aRank === 1) {
        const aMs = a.tile.playDurationMs;
        const bMs = b.tile.playDurationMs;
        if (aMs == null && bMs != null) return 1;
        if (bMs == null && aMs != null) return -1;
        if (aMs != null && bMs != null && aMs !== bMs) return bMs - aMs;
      }
      return a.index - b.index;
    })
    .map(({ tile }) => tile);
}

export function buildTiles(
  list: PlaystationPlayingPayload | undefined,
  presence: PlaystationPresencePayload | undefined,
  titles: TrophyTitleDigest[],
): Tile[] {
  const games = mergeVariants((list?.items ?? []).filter((game) => !mediaApp(game.category)));

  const playing = presence?.playing ?? null;
  // presence 没有 category；只能从未过滤的历史列表识别媒体应用，首次出现时无法区分。
  const playingIsApp = playing
    ? mediaApp(list?.items.find((game) => game.titleId === playing.titleId)?.category)
    : false;

  const toTile = (game: MergedGame, live: boolean): Tile => ({
    titleId: game.titleId,
    titleIds: game.titleIds,
    name: game.name,
    imageUrl: game.imageUrl,
    mediaApp: false,
    subtitle:
      game.preOrder && game.playCount === 0 && game.playDurationMs == null
        ? "Not started"
        : playTime(game.playDurationMs, game.playCount),
    live,
    service: game.service,
    preOrder: game.preOrder,
    platforms: game.platforms,
    trophies: digestFor(game.titleIds, titles),
    playDurationMs: game.playDurationMs,
  });

  if (!playing) return prioritizeTiles(games.map((game) => toTile(game, false)));

  const inList = games.find((game) => game.titleIds.includes(playing.titleId));
  const first: Tile = inList
    ? toTile(inList, true)
    : {
        titleId: playing.titleId,
        titleIds: [playing.titleId],
        name: playing.title,
        imageUrl: playing.iconUrl,
        subtitle:
          playing.launchPlatform ?? playing.format ?? presence?.platform ?? "PlayStation",
        live: true,
        mediaApp: playingIsApp,
        service: null,
        preOrder: false,
        platforms: consolesFromPresence(
          playing.launchPlatform,
          playing.format,
          presence?.platform,
        ),
        trophies: digestFor([playing.titleId], titles),
        playDurationMs: null,
      };
  return prioritizeTiles([
    first,
    ...games.filter((game) => game !== inList).map((game) => toTile(game, false)),
  ]);
}
