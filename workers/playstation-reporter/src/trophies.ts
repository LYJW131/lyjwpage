import {
  getProfileFromAccountId,
  getTitleTrophies,
  getTitleTrophyGroups,
  getUserTitles,
  getUserTrophiesEarnedForTitle,
  getUserTrophiesForSpecificTitle,
  getUserTrophyGroupEarningsForTitle,
  getUserTrophyProfileSummary,
} from "psn-api";

import { AuthSession } from "./auth";
import { language, type Env } from "./env";
import { type PlayedGame, type PlayedGamesReport } from "./psn";

type Loose<T> =
  T extends Array<infer Item>
    ? Array<Loose<Item>>
    : T extends object
      ? { [Key in keyof T]?: Loose<T[Key]> }
      : T;

export type TrophyType = "platinum" | "gold" | "silver" | "bronze";

export type TrophyCounts = {
  platinum: number;
  gold: number;
  silver: number;
  bronze: number;
};

export type TrophiesReport = {
  observedAt: number;
  profile: {
    onlineId: string;
    avatarUrl: string | null;
    plus: boolean;
    level: number;
    tier: number;
    trophyPoint: number;
    levelBasePoint: number;
    levelNextPoint: number;
    levelProgress: number;
    earned: TrophyCounts;
  };
  titles: Array<{
    npCommunicationId: string;
    name: string;
    localizedName: string | null;
    titleIds: string[];
    iconUrl: string | null;
    platform: string;
    progress: number;
    defined: TrophyCounts;
    earned: TrophyCounts;
    lastUpdatedAt: number | null;
    playDurationMs: number | null;
    playCount: number;
    firstPlayedAt: number | null;
    lastPlayedAt: number | null;
    service: string | null;
    preOrder: boolean;
    groups: Array<{
      id: string;
      name: string;
      iconUrl: string | null;
      progress: number;
      defined: TrophyCounts;
      earned: TrophyCounts;
    }>;
    trophies: Array<{
      id: number;
      type: TrophyType;
      name: string;
      detail: string | null;
      iconUrl: string | null;
      hidden: boolean;
      groupId: string;
      earned: boolean;
      earnedAt: number | null;
      earnedRate: number | null;
    }>;
  }>;
};

type TitleIndex = {
  npCommunicationId: string;
  trophyTitleName?: string;
  trophyTitleIconUrl?: string;
  trophyTitlePlatform?: string;
  progress?: number;
  definedTrophies?: Loose<TrophyCounts>;
  earnedTrophies?: Loose<TrophyCounts>;
  lastUpdatedDateTime?: string;
};

const TROPHY_TYPES = new Set<string>(["platinum", "gold", "silver", "bronze"]);

function languageHeader(env: Env): { "Accept-Language": string } | undefined {
  const value = language(env);
  return value ? { "Accept-Language": value } : undefined;
}

function isAccessTokenRejected(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /(?:\b401\b|\bunauthori[sz]ed\b|access token.+(?:expired|invalid)|(?:expired|invalid).+access token)/i.test(
    error.message,
  );
}

async function withToken<T>(auth: AuthSession, load: (token: string) => Promise<T>): Promise<T> {
  try {
    return await load(await auth.accessToken());
  } catch (error) {
    if (!isAccessTokenRejected(error)) throw error;
    return load(await auth.accessToken(true));
  }
}

function epochMs(iso: string | undefined): number | null {
  if (!iso) return null;
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : null;
}

function counts(raw: Loose<TrophyCounts> | undefined): TrophyCounts {
  return {
    platinum: Number(raw?.platinum) || 0,
    gold: Number(raw?.gold) || 0,
    silver: Number(raw?.silver) || 0,
    bronze: Number(raw?.bronze) || 0,
  };
}

function rate(raw: string | number | undefined): number | null {
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw !== "string" || !raw.trim()) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function titleOptions(env: Env, platform: string | undefined) {
  const localized = languageHeader(env);
  return {
    ...(platform?.includes("PS5") ? {} : { npServiceName: "trophy" as const }),
    ...(localized ? { headerOverrides: localized } : {}),
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

/** 资料头像按尺寸从大到小挑；没有尺寸标记就取最后一张（上游通常从小到大排）。 */
function profileAvatarUrl(
  avatars: Array<{ size?: string; url?: string }> | undefined,
): string | null {
  const withUrl = (avatars ?? []).filter((row) => row.url?.trim());
  if (!withUrl.length) return null;
  let raw: string | null = null;
  for (const size of ["xl", "l", "m", "s"]) {
    const hit = withUrl.find((row) => row.size?.toLowerCase() === size);
    if (hit?.url) {
      raw = hit.url.trim();
      break;
    }
  }
  raw ??= withUrl[withUrl.length - 1].url?.trim() || null;
  return raw ? raw.replace(/^http:\/\//i, "https://") : null;
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
  const raw = (await withToken(auth, (token) =>
    getUserTrophiesForSpecificTitle({ accessToken: token }, "me", {
      npTitleIds: npTitleIds.join(","),
      ...(localized ? { headerOverrides: localized } : {}),
    }),
  )) as Loose<{
    titles?: Array<{
      npTitleId?: string;
      trophyTitles?: Array<{ npCommunicationId?: string }>;
    }>;
  }>;
  return (raw.titles ?? []).map((row) => ({
    npTitleId: row.npTitleId ?? "",
    npCommunicationIds: (row.trophyTitles ?? [])
      .map((title) => title.npCommunicationId)
      .filter((id): id is string => Boolean(id)),
  }));
}

/**
 * 官方把奖杯组 NPWR… 接到游玩列表的 PPSA… / CUSA…。一次最多 5 个 titleId；
 * 没同步过奖杯或媒体应用会整批失败，再拆成单条重试。
 */
async function mapPlayByTrophyId(
  env: Env,
  auth: AuthSession,
  played: PlayedGamesReport,
): Promise<Map<string, PlayedGame[]>> {
  const games = played.items.filter(
    (game) => game.titleId && game.category?.endsWith("_media_app") !== true,
  );
  const byTitleId = new Map(games.map((game) => [game.titleId, game]));
  const ids = [...byTitleId.keys()];
  const byTrophy = new Map<string, PlayedGame[]>();

  const apply = (npTitleId: string, npCommunicationIds: string[]) => {
    const game = byTitleId.get(npTitleId);
    if (!game) return;
    for (const id of npCommunicationIds) {
      const list = byTrophy.get(id) ?? [];
      if (!list.some((item) => item.titleId === game.titleId)) list.push(game);
      byTrophy.set(id, list);
    }
  };

  async function mapChunk(chunk: string[]) {
    try {
      const rows = await requestTitleLinks(env, auth, chunk);
      for (const row of rows) apply(row.npTitleId, row.npCommunicationIds);
    } catch {
      if (chunk.length === 1) return;
      for (const id of chunk) {
        await mapChunk([id]);
        await sleep(80);
      }
    }
  }

  for (let i = 0; i < ids.length; i += TITLE_ID_BATCH) {
    await mapChunk(ids.slice(i, i + TITLE_ID_BATCH));
    if (i + TITLE_ID_BATCH < ids.length) await sleep(150);
  }

  console.log(
    JSON.stringify({
      event: "playstation-trophy-link",
      games: ids.length,
      titles: byTrophy.size,
    }),
  );
  return byTrophy;
}

export function trophiesFingerprint(titles: TitleIndex[], earned: TrophyCounts, level: number): string {
  return JSON.stringify({
    link: "titleId+avatar",
    level,
    earned,
    titles: titles.map((title) => [
      title.npCommunicationId,
      title.progress ?? 0,
      title.lastUpdatedDateTime ?? "",
      counts(title.earnedTrophies),
    ]),
  });
}

export async function fetchTrophyIndex(
  env: Env,
  auth: AuthSession,
): Promise<{ fingerprint: string; titles: TitleIndex[]; accountId: string; summary: Loose<{
  trophyLevel?: number;
  trophyPoint?: number;
  trophyLevelBasePoint?: number;
  trophyLevelNextPoint?: number;
  progress?: number;
  tier?: number;
  earnedTrophies?: Loose<TrophyCounts>;
}> }> {
  const localized = languageHeader(env);
  const headers = localized ? { headerOverrides: localized } : undefined;
  const summary = (await withToken(auth, (token) =>
    getUserTrophyProfileSummary({ accessToken: token }, "me", headers),
  )) as Loose<{
    accountId?: string;
    trophyLevel?: number;
    trophyPoint?: number;
    trophyLevelBasePoint?: number;
    trophyLevelNextPoint?: number;
    progress?: number;
    tier?: number;
    earnedTrophies?: Loose<TrophyCounts>;
  }>;

  const titles: TitleIndex[] = [];
  let offset = 0;
  for (;;) {
    const page = (await withToken(auth, (token) =>
      getUserTitles({ accessToken: token }, "me", {
        limit: 100,
        offset,
        ...headers,
      }),
    )) as Loose<{ trophyTitles?: TitleIndex[]; nextOffset?: number; totalItemCount?: number }>;
    titles.push(...(page.trophyTitles ?? []).filter((title) => title.npCommunicationId));
    if (page.nextOffset == null) break;
    offset = page.nextOffset;
    if (titles.length >= (page.totalItemCount ?? titles.length)) break;
    await sleep(120);
  }

  return {
    fingerprint: trophiesFingerprint(titles, counts(summary.earnedTrophies), Number(summary.trophyLevel) || 0),
    titles,
    accountId: String(summary.accountId ?? ""),
    summary,
  };
}

export async function fetchTrophies(
  env: Env,
  auth: AuthSession,
  played: PlayedGamesReport,
  index: Awaited<ReturnType<typeof fetchTrophyIndex>>,
): Promise<TrophiesReport> {
  const localized = languageHeader(env);
  const headers = localized ? { headerOverrides: localized } : undefined;
  if (!index.accountId) throw new Error("奖杯总览没有 accountId");

  const profile = (await withToken(auth, (token) =>
    getProfileFromAccountId({ accessToken: token }, index.accountId, headers),
  )) as Loose<{
    onlineId?: string;
    isPlus?: boolean;
    avatars?: Array<{ size?: string; url?: string }>;
  }>;

  const onlineId = profile.onlineId?.trim();
  if (!onlineId) throw new Error("PSN 资料没有 onlineId");

  const playByTrophy = await mapPlayByTrophyId(env, auth, played);
  const titles: TrophiesReport["titles"] = [];
  for (const [i, title] of index.titles.entries()) {
    const id = title.npCommunicationId;
    const opts = titleOptions(env, title.trophyTitlePlatform);
    const [defs, earned, groupDefs, groupEarned] = await Promise.all([
      withToken(auth, (token) => getTitleTrophies({ accessToken: token }, id, "all", opts)),
      withToken(auth, (token) =>
        getUserTrophiesEarnedForTitle({ accessToken: token }, "me", id, "all", opts),
      ),
      withToken(auth, (token) => getTitleTrophyGroups({ accessToken: token }, id, opts)),
      withToken(auth, (token) =>
        getUserTrophyGroupEarningsForTitle({ accessToken: token }, "me", id, opts),
      ),
    ]);

    const earnedMap = new Map(
      ((earned as Loose<{ trophies?: Array<{ trophyId?: number }> }>).trophies ?? []).map((row) => [
        row.trophyId,
        row,
      ]),
    );
    const play = playStats(playByTrophy.get(id), title.trophyTitleName?.trim() || id);
    const lastUpdatedAt =
      epochMs(
        (groupEarned as Loose<{ lastUpdatedDateTime?: string }>).lastUpdatedDateTime ??
          (earned as Loose<{ lastUpdatedDateTime?: string }>).lastUpdatedDateTime ??
          title.lastUpdatedDateTime,
      );

    titles.push({
      npCommunicationId: id,
      name: title.trophyTitleName?.trim() || id,
      localizedName: play.localizedName,
      titleIds: play.titleIds,
      iconUrl: title.trophyTitleIconUrl?.trim() || null,
      platform: title.trophyTitlePlatform?.trim() || "PS",
      progress: Number(title.progress) || 0,
      defined: counts(title.definedTrophies),
      earned: counts(title.earnedTrophies),
      lastUpdatedAt,
      playDurationMs: play.playDurationMs,
      playCount: play.playCount,
      firstPlayedAt: play.firstPlayedAt,
      lastPlayedAt: play.lastPlayedAt,
      service: play.service,
      preOrder: play.preOrder,
      groups: ((groupDefs as Loose<{ trophyGroups?: Array<Record<string, unknown>> }>).trophyGroups ?? []).map(
        (group) => {
          const earnedGroup = (
            (groupEarned as Loose<{ trophyGroups?: Array<Record<string, unknown>> }>).trophyGroups ?? []
          ).find((row) => row.trophyGroupId === group.trophyGroupId);
          return {
            id: String(group.trophyGroupId ?? "default"),
            name: String(group.trophyGroupName ?? "本体"),
            iconUrl: typeof group.trophyGroupIconUrl === "string" ? group.trophyGroupIconUrl : null,
            progress: Number(earnedGroup?.progress) || 0,
            defined: counts(group.definedTrophies as Loose<TrophyCounts> | undefined),
            earned: counts(earnedGroup?.earnedTrophies as Loose<TrophyCounts> | undefined),
          };
        },
      ),
      trophies: ((defs as Loose<{ trophies?: Array<Record<string, unknown>> }>).trophies ?? []).flatMap(
        (definition) => {
          const got = earnedMap.get(definition.trophyId as number) as Loose<Record<string, unknown>> | undefined;
          const type = String(definition.trophyType ?? "");
          if (!TROPHY_TYPES.has(type)) return [];
          const hidden = Boolean(definition.trophyHidden);
          const name =
            String(definition.trophyName ?? got?.trophyName ?? "").trim() ||
            (hidden ? "隐藏奖杯" : "未命名奖杯");
          const detail = String(definition.trophyDetail ?? got?.trophyDetail ?? "").trim();
          return [
            {
              id: Number(definition.trophyId) || 0,
              type: type as TrophyType,
              name,
              detail: detail || null,
              iconUrl:
                (typeof definition.trophyIconUrl === "string" && definition.trophyIconUrl) ||
                (typeof got?.trophyIconUrl === "string" && got.trophyIconUrl) ||
                null,
              hidden,
              groupId: String(definition.trophyGroupId ?? "default"),
              earned: Boolean(got?.earned),
              earnedAt: epochMs(typeof got?.earnedDateTime === "string" ? got.earnedDateTime : undefined),
              earnedRate: rate(
                (got?.trophyEarnedRate as string | number | undefined) ??
                  (definition.trophyEarnedRate as string | number | undefined),
              ),
            },
          ];
        },
      ),
    });

    if (i < index.titles.length - 1) await sleep(150);
  }

  return {
    observedAt: Date.now(),
    profile: {
      onlineId,
      avatarUrl: profileAvatarUrl(profile.avatars),
      plus: profile.isPlus === true,
      level: Number(index.summary.trophyLevel) || 0,
      tier: Number(index.summary.tier) || 0,
      trophyPoint: Number(index.summary.trophyPoint) || 0,
      levelBasePoint: Number(index.summary.trophyLevelBasePoint) || 0,
      levelNextPoint: Number(index.summary.trophyLevelNextPoint) || 0,
      levelProgress: Number(index.summary.progress) || 0,
      earned: counts(index.summary.earnedTrophies),
    },
    titles,
  };
}
