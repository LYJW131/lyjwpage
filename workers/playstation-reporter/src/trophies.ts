import {
  getProfileFromAccountId,
  getTitleTrophies,
  getTitleTrophyGroups,
  getUserTitles,
  getUserTrophiesEarnedForTitle,
  getUserTrophiesForSpecificTitle,
  getUserTrophyGroupEarningsForTitle,
  getUserTrophyProfileSummary,
  type ProfileFromAccountIdResponse,
  type TitleThinTrophy,
  type TitleTrophiesResponse,
  type TitleTrophyGroupsResponse,
  type Trophy as PsnTrophy,
  type TrophyTitle,
  type UserThinTrophy,
  type UserTitlesResponse,
  type UserTrophiesBySpecificTitleResponse,
  type UserTrophiesEarnedForTitleResponse,
  type UserTrophyGroupEarningsForTitleResponse,
  type UserTrophyProfileSummaryResponse,
} from "psn-api";

import { AuthSession } from "./auth";
import { type Env } from "./env";
import { type PlayedGame, type PlayedGamesReport } from "./psn";
import {
  assertNoPsnError,
  epochMs,
  languageHeader,
  nonNegative,
  nonNegativeInt,
  percent,
  sleep,
  trimmed,
  withToken,
  type Loose,
} from "./util";

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

/** 目录里没有 npCommunicationId 的行取不了明细，进不了这个类型。 */
export type TitleIndex = Loose<TrophyTitle> & { npCommunicationId: string };

/** 上游还给三个点数字段，psn-api 2.18.1 的响应类型里没有；缺席就当 0。 */
type TrophySummary = Loose<
  UserTrophyProfileSummaryResponse & {
    trophyPoint: number;
    trophyLevelBasePoint: number;
    trophyLevelNextPoint: number;
  }
>;

/** 稀有度只在「已获得」那份里，psn-api 的定义类型没带；两份都读，谁有算谁。 */
type DefinedTrophy = Loose<TitleThinTrophy & Pick<PsnTrophy, "trophyEarnedRate">>;

/** 反过来，名字 / 说明 / 图标按类型只在定义那份里；上游偶尔多给，给了就当补充。 */
type EarnedTrophy = Loose<
  UserThinTrophy & Pick<TitleThinTrophy, "trophyName" | "trophyDetail" | "trophyIconUrl">
>;

type TrophyGroupDefinition = NonNullable<Loose<TitleTrophyGroupsResponse>["trophyGroups"]>[number];
type TrophyGroupEarnings = NonNullable<
  Loose<UserTrophyGroupEarningsForTitleResponse>["trophyGroups"]
>[number];

const TROPHY_TYPES = new Set<string>(["platinum", "gold", "silver", "bronze"]);

function isTrophyType(value: string): value is TrophyType {
  return TROPHY_TYPES.has(value);
}

function counts(raw: Loose<TrophyCounts> | undefined): TrophyCounts {
  return {
    platinum: nonNegative(raw?.platinum),
    gold: nonNegative(raw?.gold),
    silver: nonNegative(raw?.silver),
    bronze: nonNegative(raw?.bronze),
  };
}

/** 上游给的是字符串百分比；站点按 0–100 硬校验，越界钳回。 */
function rate(raw: string | number | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "string" && !raw.trim()) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? percent(parsed) : null;
}

function titleOptions(env: Env, platform: string | undefined) {
  const localized = languageHeader(env);
  return {
    ...(platform?.includes("PS5") ? {} : { npServiceName: "trophy" as const }),
    ...(localized ? { headerOverrides: localized } : {}),
  };
}

type TitleOptions = ReturnType<typeof titleOptions>;

const TITLE_ID_BATCH = 5;
const PAGE_LIMIT = 100;
/** 兜底：nextOffset 一直不为空也不能无限打上游。100 页 × 100 条远超单个奖杯组。 */
const MAX_PAGES = 100;

/**
 * 免费版一次调用 50 个子请求。presence 半边约 10–15（含 token 刷新、
 * 游玩/购买库、交付、指纹 KV）；本轮多读一次 trophySync。
 * 奖杯总览 2–3；6 款 × 4 = 24；游标写入 1；meta 1。
 * 最坏 15+1+3+24+1+1 = 45。
 */
export const TROPHY_TITLES_PER_TICK = 6;

/**
 * 组装轮不再爬明细。对齐一次 5 个 titleId；12 批 = 60 个，
 * 叠上 presence + index + 资料 + 交付 / 指纹 / 删游标，仍低于 50。
 * 游玩列表更长就再占一轮，不跟 6 款明细抢预算。
 */
export const PLAY_LINK_BATCHES_PER_TICK = 12;

type PsnPage<Row> = {
  rows: Row[] | undefined;
  nextOffset: number | undefined;
  totalItemCount: number | undefined;
};

/**
 * 分页端点统一走这里：取到 nextOffset 消失为止，收尾拿 totalItemCount 对一遍条数。
 * 少一行就抛 —— 被截断的目录和真的变短的目录在指纹上一模一样，一旦写进指纹，
 * 就要等下一次真变化才会自愈。
 */
async function collectPages<Row>(
  what: string,
  load: (offset: number) => Promise<PsnPage<Row>>,
): Promise<Row[]> {
  const rows: Row[] = [];
  let offset = 0;
  let total: number | null = null;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const body = await load(offset);
    rows.push(...(body.rows ?? []));
    if (typeof body.totalItemCount === "number") total = body.totalItemCount;
    const next = body.nextOffset;
    // nextOffset 不前进就是上游在原地打转，停下来交给下面的条数断言。
    if (next == null || next <= offset) break;
    if (total != null && rows.length >= total) break;
    offset = next;
    await sleep(120);
  }
  if (total != null && rows.length !== total) {
    throw new Error(`PSN ${what} 只取到 ${rows.length} / ${total} 条`);
  }
  return rows;
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
  raw ??= trimmed(withUrl[withUrl.length - 1]?.url);
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

/** 媒体应用对不齐奖杯组，对齐前就丢掉，避免整批 titleId 请求被它带挂。 */
export function playLinkGames(played: PlayedGamesReport): PlayedGame[] {
  const games = played.items.filter(
    (game) => game.titleId && game.category?.endsWith("_media_app") !== true,
  );
  return [...new Map(games.map((game) => [game.titleId, game])).values()];
}

/**
 * 官方把奖杯组 NPWR… 接到游玩列表的 PPSA… / CUSA…。一次最多 5 个 titleId；
 * 没同步过奖杯或媒体应用会整批失败，再拆成单条重试。
 */
export async function mapPlayByTrophySlice(
  env: Env,
  auth: AuthSession,
  games: PlayedGame[],
  offset: number,
  maxBatches: number,
): Promise<{ nextOffset: number; byTrophy: Record<string, PlayedGame[]> }> {
  const byTitleId = new Map(games.map((game) => [game.titleId, game]));
  const ids = games.map((game) => game.titleId);
  const end = Math.min(ids.length, Math.max(offset, 0) + maxBatches * TITLE_ID_BATCH);
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

  for (let i = offset; i < end; i += TITLE_ID_BATCH) {
    await mapChunk(ids.slice(i, Math.min(i + TITLE_ID_BATCH, end)));
    if (i + TITLE_ID_BATCH < end) await sleep(150);
  }

  return { nextOffset: end, byTrophy };
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
): Promise<{
  fingerprint: string;
  titles: TitleIndex[];
  accountId: string;
  summary: TrophySummary;
}> {
  const localized = languageHeader(env);
  const headers = localized ? { headerOverrides: localized } : undefined;
  const summary: TrophySummary = assertNoPsnError(
    await withToken(auth, (token) =>
      getUserTrophyProfileSummary({ accessToken: token }, "me", headers),
    ),
    "奖杯总览",
  );

  const rows = await collectPages<Loose<TrophyTitle>>("奖杯目录", async (offset) => {
    const page: Loose<UserTitlesResponse> = assertNoPsnError(
      await withToken(auth, (token) =>
        getUserTitles({ accessToken: token }, "me", { limit: PAGE_LIMIT, offset, ...headers }),
      ),
      "奖杯目录",
    );
    return {
      rows: page.trophyTitles,
      nextOffset: page.nextOffset,
      totalItemCount: page.totalItemCount,
    };
  });
  // 条数断言在过滤之前做完：没有 npCommunicationId 的行是合法的少数派，不该算截断。
  const titles = rows.filter((row): row is TitleIndex => Boolean(row.npCommunicationId));
  if (titles.length !== rows.length) {
    console.log(
      JSON.stringify({
        event: "playstation-trophy-index",
        titles: titles.length,
        dropped: rows.length - titles.length,
      }),
    );
  }

  return {
    fingerprint: trophiesFingerprint(titles, counts(summary.earnedTrophies), nonNegativeInt(summary.trophyLevel)),
    titles,
    accountId: String(summary.accountId ?? ""),
    summary,
  };
}

async function fetchTrophyDefinitions(
  auth: AuthSession,
  id: string,
  opts: TitleOptions,
): Promise<DefinedTrophy[]> {
  return collectPages<DefinedTrophy>(`${id} 的奖杯定义`, async (offset) => {
    const page: Loose<TitleTrophiesResponse> = assertNoPsnError(
      await withToken(auth, (token) =>
        getTitleTrophies({ accessToken: token }, id, "all", { ...opts, limit: PAGE_LIMIT, offset }),
      ),
      `${id} 的奖杯定义`,
    );
    return {
      rows: page.trophies,
      nextOffset: page.nextOffset,
      totalItemCount: page.totalItemCount,
    };
  });
}

async function fetchTrophiesEarned(
  auth: AuthSession,
  id: string,
  opts: TitleOptions,
): Promise<{ trophies: EarnedTrophy[]; lastUpdatedDateTime: string | undefined }> {
  let lastUpdatedDateTime: string | undefined;
  const trophies = await collectPages<EarnedTrophy>(`${id} 的已获得奖杯`, async (offset) => {
    // 这个入口自己检查 {error}，不用再断言一次。
    const page: Loose<UserTrophiesEarnedForTitleResponse> = await withToken(auth, (token) =>
      getUserTrophiesEarnedForTitle({ accessToken: token }, "me", id, "all", {
        ...opts,
        limit: PAGE_LIMIT,
        offset,
      }),
    );
    lastUpdatedDateTime ??= page.lastUpdatedDateTime;
    return {
      rows: page.trophies,
      nextOffset: page.nextOffset,
      totalItemCount: page.totalItemCount,
    };
  });
  return { trophies, lastUpdatedDateTime };
}

async function fetchTrophyTitle(
  env: Env,
  auth: AuthSession,
  title: TitleIndex,
): Promise<TrophiesReport["titles"][number]> {
  const id = title.npCommunicationId;
  const opts = titleOptions(env, title.trophyTitlePlatform);
  const [defs, earned, groupDefs, groupEarned] = await Promise.all([
    fetchTrophyDefinitions(auth, id, opts),
    fetchTrophiesEarned(auth, id, opts),
    withToken(auth, (token) => getTitleTrophyGroups({ accessToken: token }, id, opts)).then(
      (raw): Loose<TitleTrophyGroupsResponse> => assertNoPsnError(raw, `${id} 的奖杯组`),
    ),
    // 这个入口自己检查 {error}，不用再断言一次。
    withToken(
      auth,
      (token): Promise<Loose<UserTrophyGroupEarningsForTitleResponse>> =>
        getUserTrophyGroupEarningsForTitle({ accessToken: token }, "me", id, opts),
    ),
  ]);

  // 没有 trophyId 的行进不了 map：否则两条都以 undefined 为键，会把获得情况接错人。
  const earnedMap = new Map(
    earned.trophies.filter((row) => row.trophyId != null).map((row) => [row.trophyId, row]),
  );
  const lastUpdatedAt = epochMs(
    groupEarned.lastUpdatedDateTime ?? earned.lastUpdatedDateTime ?? title.lastUpdatedDateTime,
  );

  // titleIds 对齐在全部爬完之后做：分片里先占位，避免半份目录带着过期映射被交出去。
  return {
    npCommunicationId: id,
    name: trimmed(title.trophyTitleName) ?? id,
    localizedName: null,
    titleIds: [],
    iconUrl: trimmed(title.trophyTitleIconUrl),
    platform: trimmed(title.trophyTitlePlatform) ?? "PS",
    progress: percent(title.progress),
    defined: counts(title.definedTrophies),
    earned: counts(title.earnedTrophies),
    lastUpdatedAt,
    playDurationMs: null,
    playCount: 0,
    firstPlayedAt: null,
    lastPlayedAt: null,
    service: null,
    preOrder: false,
    groups: (groupDefs.trophyGroups ?? []).map((group: TrophyGroupDefinition) => {
      const earnedGroup: TrophyGroupEarnings | undefined = (groupEarned.trophyGroups ?? []).find(
        (row) => row.trophyGroupId === group.trophyGroupId,
      );
      return {
        id: trimmed(group.trophyGroupId) ?? "default",
        name: trimmed(group.trophyGroupName) ?? "本体",
        iconUrl: trimmed(group.trophyGroupIconUrl),
        progress: percent(earnedGroup?.progress),
        defined: counts(group.definedTrophies),
        earned: counts(earnedGroup?.earnedTrophies),
      };
    }),
    trophies: defs.flatMap((definition) => {
      const type = definition.trophyType ?? "";
      if (!isTrophyType(type)) return [];
      const got = definition.trophyId == null ? undefined : earnedMap.get(definition.trophyId);
      const hidden = Boolean(definition.trophyHidden);
      return [
        {
          id: nonNegativeInt(definition.trophyId),
          type,
          name:
            trimmed(definition.trophyName) ??
            trimmed(got?.trophyName) ??
            (hidden ? "隐藏奖杯" : "未命名奖杯"),
          detail: trimmed(definition.trophyDetail) ?? trimmed(got?.trophyDetail),
          iconUrl: trimmed(definition.trophyIconUrl) ?? trimmed(got?.trophyIconUrl),
          hidden,
          groupId: trimmed(definition.trophyGroupId) ?? "default",
          earned: Boolean(got?.earned),
          earnedAt: epochMs(got?.earnedDateTime),
          earnedRate: rate(got?.trophyEarnedRate ?? definition.trophyEarnedRate),
        },
      ];
    }),
  };
}

export async function fetchTrophyTitleSlice(
  env: Env,
  auth: AuthSession,
  titles: TitleIndex[],
): Promise<TrophiesReport["titles"]> {
  const out: TrophiesReport["titles"] = [];
  for (const [i, title] of titles.entries()) {
    out.push(await fetchTrophyTitle(env, auth, title));
    if (i < titles.length - 1) await sleep(150);
  }
  return out;
}

export function applyPlayStats(
  titles: TrophiesReport["titles"],
  byTrophy: Record<string, PlayedGame[]>,
): TrophiesReport["titles"] {
  return titles.map((title) => {
    const play = playStats(byTrophy[title.npCommunicationId], title.name);
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

export async function buildTrophiesReport(
  env: Env,
  auth: AuthSession,
  index: Awaited<ReturnType<typeof fetchTrophyIndex>>,
  titles: TrophiesReport["titles"],
  byTrophy: Record<string, PlayedGame[]>,
): Promise<TrophiesReport> {
  const localized = languageHeader(env);
  const headers = localized ? { headerOverrides: localized } : undefined;
  if (!index.accountId) throw new Error("奖杯总览没有 accountId");

  // 这个入口自己检查 {error}，不用再断言一次。
  const profile: Loose<ProfileFromAccountIdResponse> = await withToken(auth, (token) =>
    getProfileFromAccountId({ accessToken: token }, index.accountId, headers),
  );

  const onlineId = trimmed(profile.onlineId);
  if (!onlineId) throw new Error("PSN 资料没有 onlineId");

  const linked = applyPlayStats(titles, byTrophy);
  console.log(
    JSON.stringify({
      event: "playstation-trophy-link",
      games: Object.values(byTrophy).reduce((sum, games) => sum + games.length, 0),
      titles: Object.keys(byTrophy).length,
    }),
  );

  return {
    observedAt: Date.now(),
    profile: {
      onlineId,
      avatarUrl: profileAvatarUrl(profile.avatars),
      plus: profile.isPlus === true,
      level: nonNegativeInt(index.summary.trophyLevel),
      tier: nonNegativeInt(index.summary.tier),
      trophyPoint: nonNegative(index.summary.trophyPoint),
      levelBasePoint: nonNegative(index.summary.trophyLevelBasePoint),
      levelNextPoint: nonNegative(index.summary.trophyLevelNextPoint),
      levelProgress: percent(index.summary.progress),
      earned: counts(index.summary.earnedTrophies),
    },
    titles: linked,
  };
}
