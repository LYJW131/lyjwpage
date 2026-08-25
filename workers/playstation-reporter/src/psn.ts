import {
  getBasicPresence,
  getPurchasedGames,
  type BasicPresenceResponse,
  type PurchasedGame,
  type UserPlayedGamesResponse,
} from "psn-api";

import { AuthSession } from "./auth";
import { accountId, type Env } from "./env";
import {
  epochMs,
  languageHeader,
  nonNegative,
  sleep,
  trimmed,
  withToken,
  type Loose,
} from "./util";

export type NowPlaying = {
  titleId: string;
  title: string;
  format: string | null;
  launchPlatform: string | null;
  iconUrl: string | null;
};

export type PresenceReport = {
  observedAt: number;
  online: boolean;
  availability: string | null;
  platform: string | null;
  lastOnlineAt: number | null;
  playing: NowPlaying | null;
};

export type PlayedGame = {
  titleId: string;
  name: string;
  /** 上游枚举，如 ps4_game / ps5_native_game / ps5_native_media_app / pspc_game / unknown。 */
  category: string | null;
  playCount: number;
  firstPlayedAt: number | null;
  lastPlayedAt: number | null;
  playDurationMs: number | null;
  imageUrl: string | null;
  /** 上游枚举，已见 ps_plus / none(purchased) / other。缺席为 null。 */
  service: string | null;
  preOrder: boolean;
};

export type LibraryTitle = {
  titleId: string;
  name: string;
  imageUrl: string | null;
  preOrder: boolean;
  membership: string | null;
};

export type PlayedGamesReport = {
  observedAt: number;
  items: PlayedGame[];
};

function platformName(raw: string | undefined): string | null {
  return trimmed(raw)?.toUpperCase() ?? null;
}

/** ISO-8601 时长换成毫秒；累计小时可以超过 24，另兼容规范里的天和周。 */
export function durationMs(raw: string | undefined): number | null {
  const value = raw?.trim();
  if (!value) return null;
  const matched =
    /^P(?:(\d+(?:\.\d+)?)W)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(
      value,
    );
  if (!matched) return null;
  const [, weeks, days, hours, minutes, seconds] = matched;
  if (![weeks, days, hours, minutes, seconds].some((part) => part !== undefined)) return null;
  const total =
    Number(weeks ?? 0) * 604_800 +
    Number(days ?? 0) * 86_400 +
    Number(hours ?? 0) * 3_600 +
    Number(minutes ?? 0) * 60 +
    Number(seconds ?? 0);
  return Number.isFinite(total) ? Math.round(total * 1000) : null;
}

export async function fetchPresence(env: Env, auth: AuthSession): Promise<PresenceReport> {
  const localized = languageHeader(env);
  // 这个入口自己检查 {error}，不用再断言一次。
  const raw: Loose<BasicPresenceResponse> = await withToken(auth, (token) =>
    getBasicPresence(
      { accessToken: token },
      accountId(env),
      localized ? { headerOverrides: localized } : undefined,
    ),
  );

  const presence = raw.basicPresence;
  const primary = presence?.primaryPlatformInfo;
  const title = presence?.gameTitleInfoList?.[0];
  const titleId = trimmed(title?.npTitleId);
  const titleName = trimmed(title?.titleName);
  return {
    observedAt: Date.now(),
    online: primary?.onlineStatus === "online",
    availability: trimmed(presence?.availability),
    platform: platformName(primary?.platform),
    lastOnlineAt: epochMs(primary?.lastOnlineDate),
    playing:
      titleId && titleName
        ? {
            titleId,
            title: titleName,
            format: platformName(title?.format),
            launchPlatform: platformName(title?.launchPlatform),
            iconUrl: trimmed(title?.npTitleIconUrl) ?? trimmed(title?.conceptIconUrl),
          }
        : null,
  };
}

/**
 * psn-api 2.18.1 的 getUserPlayedGames 不接 headerOverrides，实现也不发语言头，
 * 因而这一个请求继续直打与它相同的端点，保住官方中文游戏名。
 *
 * 分页拉全份，给奖杯侧用官方 titleId 对齐时长；推给站点的条数由
 * `playedGamesLimit` 在 tick 里再切。
 */
const USER_GAMES_BASE_URL = "https://m.np.playstation.com/api/gamelist/v2/users";
const PLAYED_GAMES_PAGE = 100;

async function requestPlayedGames(
  env: Env,
  token: string,
  offset: number,
): Promise<Loose<UserPlayedGamesResponse>> {
  const id = encodeURIComponent(accountId(env));
  const query = new URLSearchParams({ limit: String(PLAYED_GAMES_PAGE) });
  if (offset > 0) query.set("offset", String(offset));
  const response = await fetch(`${USER_GAMES_BASE_URL}/${id}/titles?${query}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      ...languageHeader(env),
    },
  });
  if (!response.ok) {
    const body = (await response.text().catch(() => "")).slice(0, 200);
    throw new Error(`PSN 返回 ${response.status}：${body}`);
  }
  return (await response.json()) as Loose<UserPlayedGamesResponse>;
}

/** 站点按非空 / 非负硬校验，一条越界就退整封信；名字缺席回落 titleId，别发空串。 */
function readPlayedGame(title: Loose<UserPlayedGamesResponse["titles"][number]>): PlayedGame | null {
  const titleId = trimmed(title?.titleId);
  if (!titleId) return null;
  return {
    titleId,
    name: trimmed(title.name) ?? trimmed(title.localizedName) ?? titleId,
    category: trimmed(title.category),
    playCount: nonNegative(title.playCount),
    firstPlayedAt: epochMs(title.firstPlayedDateTime),
    lastPlayedAt: epochMs(title.lastPlayedDateTime),
    playDurationMs: durationMs(title.playDuration),
    imageUrl: trimmed(title.imageUrl) ?? trimmed(title.localizedImageUrl),
    service: trimmed(title.service),
    preOrder: false,
  };
}

const PURCHASED_PAGE = 50;
const PURCHASED_CAP = 400;

function httpsUrl(value: string | null | undefined): string | null {
  const url = trimmed(value);
  return url ? url.replace(/^http:\/\//i, "https://") : null;
}

export function plusService(membership: string | null | undefined): string | null {
  return membership === "PS_PLUS" ? "ps_plus" : null;
}

function mergeLibraryTitle(prior: LibraryTitle | undefined, game: Loose<PurchasedGame>): LibraryTitle | null {
  const titleId = game.titleId?.trim();
  if (!titleId) return null;
  const membership = game.membership?.trim() || null;
  return {
    titleId,
    name: game.name?.trim() || prior?.name || titleId,
    imageUrl: httpsUrl(game.image?.url) ?? prior?.imageUrl ?? null,
    preOrder: prior?.preOrder === true || game.isPreOrder === true,
    membership:
      prior?.membership === "PS_PLUS" || membership === "PS_PLUS"
        ? "PS_PLUS"
        : membership ?? prior?.membership ?? null,
  };
}

/**
 * 购买库（只含 PS4 / PS5）。用来标预购，以及给没开过档的预购补一条。
 * Plus 权益仍以游玩列表的 `service` 为准：买断后可能变成 none_purchased。
 */
export async function fetchPurchasedLibrary(
  env: Env,
  auth: AuthSession,
): Promise<LibraryTitle[]> {
  const byId = new Map<string, LibraryTitle>();
  let start = 0;
  for (;;) {
    const raw = await withToken(auth, (token) =>
      getPurchasedGames(
        { accessToken: token },
        {
          isActive: true,
          platform: ["ps4", "ps5"],
          size: PURCHASED_PAGE,
          start,
          sortBy: "ACTIVE_DATE",
          sortDirection: "desc",
        },
      ),
    );
    const games = raw.data?.purchasedTitlesRetrieve?.games ?? [];
    for (const game of games) {
      const next = mergeLibraryTitle(byId.get(game.titleId?.trim() ?? ""), game);
      if (next) byId.set(next.titleId, next);
    }
    if (games.length < PURCHASED_PAGE) break;
    start += games.length;
    if (byId.size >= PURCHASED_CAP) break;
    await sleep(120);
  }
  return [...byId.values()];
}

/** 游玩列表已有 `service` 时不覆盖。购买库只补预购，以及缺席时的 Plus。 */
export function overlayLibrary(
  played: PlayedGamesReport,
  library: LibraryTitle[],
): PlayedGamesReport {
  if (!library.length) return played;
  const byId = new Map(library.map((item) => [item.titleId, item]));
  return {
    ...played,
    items: played.items.map((game) => {
      const hit = byId.get(game.titleId);
      if (!hit) return game;
      return {
        ...game,
        service: game.service ?? plusService(hit.membership),
        preOrder: game.preOrder || hit.preOrder,
      };
    }),
  };
}

export function withUnplayedPreorders(
  recent: PlayedGamesReport,
  allPlayed: PlayedGamesReport,
  library: LibraryTitle[],
): PlayedGamesReport {
  const seen = new Set(allPlayed.items.map((game) => game.titleId));
  const extras: PlayedGame[] = [];
  for (const item of library) {
    if (!item.preOrder || seen.has(item.titleId)) continue;
    extras.push({
      titleId: item.titleId,
      name: item.name,
      category: null,
      playCount: 0,
      firstPlayedAt: null,
      lastPlayedAt: null,
      playDurationMs: null,
      imageUrl: item.imageUrl,
      service: plusService(item.membership),
      preOrder: true,
    });
  }
  if (!extras.length) return recent;
  return { ...recent, items: [...recent.items, ...extras] };
}

export async function fetchPlayedGames(
  env: Env,
  auth: AuthSession,
): Promise<PlayedGamesReport> {
  const items: PlayedGame[] = [];
  let offset = 0;
  for (;;) {
    const raw = await withToken(auth, (token) => requestPlayedGames(env, token, offset));
    for (const title of raw.titles ?? []) {
      const game = readPlayedGame(title);
      if (game) items.push(game);
    }
    if (raw.nextOffset == null) break;
    offset = raw.nextOffset;
    if (items.length >= (raw.totalItemCount ?? items.length)) break;
    await sleep(120);
  }
  return { observedAt: Date.now(), items };
}
