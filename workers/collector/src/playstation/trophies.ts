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
  retryRateLimit,
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

export type TrophyIndexSnapshot = {
  npCommunicationId: string;
  progress: number;
  lastUpdatedDateTime: string;
  earned: TrophyCounts;
  defined: TrophyCounts;
};

export type TrophyTitleReport = TrophiesReport["titles"][number];

/** 上游还给三个点数字段，psn-api 2.18.1 的响应类型里没有；缺席就当 0。 */
export type TrophySummary = Loose<
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
/** 每款 2–4 路并行，Worker 同时出站上限 6，两款一起跑。 */
const TITLE_CRAWL_CONCURRENCY = 2;
const PAGE_LIMIT = 100;
/** 兜底：nextOffset 一直不为空也不能无限打上游。100 页 × 100 条远超单个奖杯组。 */
const MAX_PAGES = 100;

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
    const body = await retryRateLimit(() => load(offset));
    rows.push(...(body.rows ?? []));
    if (typeof body.totalItemCount === "number") total = body.totalItemCount;
    const next = body.nextOffset;
    // nextOffset 不前进就是上游在原地打转，停下来交给下面的条数断言。
    if (next == null || next <= offset) break;
    if (total != null && rows.length >= total) break;
    offset = next;
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
 * 官方把奖杯组 NPWR… 接到游玩列表的 PPSA… / CUSA…。一次最多 5 个 titleId
 * （上游限制，不是 Worker 预算）；没同步过奖杯或媒体应用会整批失败，再拆成单条重试。
 */
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

export function countsEqual(a: TrophyCounts, b: TrophyCounts): boolean {
  return (
    a.platinum === b.platinum && a.gold === b.gold && a.silver === b.silver && a.bronze === b.bronze
  );
}

export function trophySummarySignature(
  hidden: Set<string>,
  summary: TrophySummary,
): string {
  return JSON.stringify({
    hidden: [...hidden].sort(),
    drop: "after-link",
    link: "titleId+avatar",
    level: nonNegativeInt(summary.trophyLevel),
    earned: counts(summary.earnedTrophies),
  });
}

export function snapshotIndex(titles: TitleIndex[]): TrophyIndexSnapshot[] {
  return titles.map((title) => ({
    npCommunicationId: title.npCommunicationId,
    progress: percent(title.progress),
    lastUpdatedDateTime: title.lastUpdatedDateTime ?? "",
    earned: counts(title.earnedTrophies),
    defined: counts(title.definedTrophies),
  }));
}

/** 相对上次交付的目录，哪些标题的进度 / 时间戳 / 杯数变了（含新出现的）。 */
export function dirtyIndexRows(prev: TrophyIndexSnapshot[], next: TitleIndex[]): TitleIndex[] {
  const prevById = new Map(prev.map((row) => [row.npCommunicationId, row]));
  return next.filter((row) => {
    const old = prevById.get(row.npCommunicationId);
    if (!old) return true;
    return (
      old.progress !== percent(row.progress) ||
      old.lastUpdatedDateTime !== (row.lastUpdatedDateTime ?? "") ||
      !countsEqual(old.earned, counts(row.earnedTrophies)) ||
      !countsEqual(old.defined, counts(row.definedTrophies))
    );
  });
}

export function mergeTrophyTitles(
  base: TrophyTitleReport[],
  fresh: TrophyTitleReport[],
  currentIds: string[],
): TrophyTitleReport[] {
  const byId = new Map(base.map((title) => [title.npCommunicationId, title]));
  for (const title of fresh) byId.set(title.npCommunicationId, title);
  const merged: TrophyTitleReport[] = [];
  for (const id of currentIds) {
    const title = byId.get(id);
    if (title) merged.push(title);
  }
  return merged;
}

export function canReuseDefinitions(
  previous: TrophyTitleReport | undefined,
  row: TitleIndex,
): boolean {
  if (!previous?.trophies.length || !previous.groups.length) return false;
  return countsEqual(previous.defined, counts(row.definedTrophies));
}

/** 用已有 titleIds 反查游玩列表，刷新时长 / Plus，不必再打对齐接口。 */
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

export function trophiesFingerprint(titles: TitleIndex[], earned: TrophyCounts, level: number): string {
  return JSON.stringify({
    link: "titleId+avatar",
    level,
    earned,
    titles: titles.map((title) => [
      title.npCommunicationId,
      percent(title.progress),
      title.lastUpdatedDateTime ?? "",
      counts(title.earnedTrophies),
      counts(title.definedTrophies),
    ]),
  });
}

export async function fetchTrophySummary(env: Env, auth: AuthSession): Promise<TrophySummary> {
  const localized = languageHeader(env);
  const headers = localized ? { headerOverrides: localized } : undefined;
  return retryRateLimit(async () =>
    assertNoPsnError(
      await withToken(auth, (token) =>
        getUserTrophyProfileSummary({ accessToken: token }, "me", headers),
      ),
      "奖杯总览",
    ),
  );
}

export async function fetchTrophyTitles(env: Env, auth: AuthSession): Promise<TitleIndex[]> {
  const localized = languageHeader(env);
  const headers = localized ? { headerOverrides: localized } : undefined;
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
  return titles;
}

export function indexFingerprint(titles: TitleIndex[], summary: TrophySummary): string {
  return trophiesFingerprint(
    titles,
    counts(summary.earnedTrophies),
    nonNegativeInt(summary.trophyLevel),
  );
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

function earnedFitsPrevious(
  previous: TrophyTitleReport,
  earned: EarnedTrophy[],
  groupEarned: Loose<UserTrophyGroupEarningsForTitleResponse>,
): boolean {
  const prevTrophyIds = new Set(previous.trophies.map((row) => row.id));
  if (
    earned.some(
      (row) => row.trophyId != null && !prevTrophyIds.has(nonNegativeInt(row.trophyId)),
    )
  ) {
    return false;
  }
  const prevGroupIds = new Set(previous.groups.map((group) => group.id));
  return (groupEarned.trophyGroups ?? []).every((group) =>
    prevGroupIds.has(trimmed(group.trophyGroupId) ?? "default"),
  );
}

function stitchEarned(
  previous: TrophyTitleReport,
  title: TitleIndex,
  earned: Awaited<ReturnType<typeof fetchTrophiesEarned>>,
  groupEarned: Loose<UserTrophyGroupEarningsForTitleResponse>,
): TrophyTitleReport {
  const earnedMap = new Map(
    earned.trophies.filter((row) => row.trophyId != null).map((row) => [row.trophyId, row]),
  );
  return {
    ...previous,
    name: trimmed(title.trophyTitleName) ?? previous.name,
    iconUrl: trimmed(title.trophyTitleIconUrl) ?? previous.iconUrl,
    platform: trimmed(title.trophyTitlePlatform) ?? previous.platform,
    progress: percent(title.progress),
    defined: counts(title.definedTrophies),
    earned: counts(title.earnedTrophies),
    lastUpdatedAt: epochMs(
      groupEarned.lastUpdatedDateTime ?? earned.lastUpdatedDateTime ?? title.lastUpdatedDateTime,
    ),
    groups: previous.groups.map((group) => {
      const earnedGroup: TrophyGroupEarnings | undefined = (groupEarned.trophyGroups ?? []).find(
        (row) => (trimmed(row.trophyGroupId) ?? "default") === group.id,
      );
      return {
        ...group,
        progress: percent(earnedGroup?.progress ?? group.progress),
        earned: earnedGroup ? counts(earnedGroup.earnedTrophies) : group.earned,
      };
    }),
    trophies: previous.trophies.map((row) => {
      const got = earnedMap.get(row.id);
      if (!got) return row;
      return {
        ...row,
        earned: Boolean(got.earned),
        earnedAt: epochMs(got.earnedDateTime),
        earnedRate: rate(got.trophyEarnedRate) ?? row.earnedRate,
      };
    }),
  };
}

function assembleTitle(
  title: TitleIndex,
  defs: DefinedTrophy[],
  earned: Awaited<ReturnType<typeof fetchTrophiesEarned>>,
  groupDefs: Loose<TitleTrophyGroupsResponse>,
  groupEarned: Loose<UserTrophyGroupEarningsForTitleResponse>,
  previous?: TrophyTitleReport,
): TrophyTitleReport {
  const id = title.npCommunicationId;
  const earnedMap = new Map(
    earned.trophies.filter((row) => row.trophyId != null).map((row) => [row.trophyId, row]),
  );
  return {
    npCommunicationId: id,
    name: trimmed(title.trophyTitleName) ?? id,
    localizedName: previous?.localizedName ?? null,
    titleIds: previous?.titleIds ?? [],
    iconUrl: trimmed(title.trophyTitleIconUrl),
    platform: trimmed(title.trophyTitlePlatform) ?? "PS",
    progress: percent(title.progress),
    defined: counts(title.definedTrophies),
    earned: counts(title.earnedTrophies),
    lastUpdatedAt: epochMs(
      groupEarned.lastUpdatedDateTime ?? earned.lastUpdatedDateTime ?? title.lastUpdatedDateTime,
    ),
    playDurationMs: previous?.playDurationMs ?? null,
    playCount: previous?.playCount ?? 0,
    firstPlayedAt: previous?.firstPlayedAt ?? null,
    lastPlayedAt: previous?.lastPlayedAt ?? null,
    service: previous?.service ?? null,
    preOrder: previous?.preOrder ?? false,
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

async function fetchTrophyTitle(
  env: Env,
  auth: AuthSession,
  title: TitleIndex,
  previous?: TrophyTitleReport,
): Promise<TrophyTitleReport> {
  const id = title.npCommunicationId;
  const opts = titleOptions(env, title.trophyTitlePlatform);
  const reuse = canReuseDefinitions(previous, title);

  const earnedPromise = fetchTrophiesEarned(auth, id, opts);
  const groupEarnedPromise: Promise<Loose<UserTrophyGroupEarningsForTitleResponse>> = retryRateLimit(
    () =>
      withToken(auth, (token) =>
        getUserTrophyGroupEarningsForTitle({ accessToken: token }, "me", id, opts),
      ),
  );

  if (reuse && previous) {
    const [earned, groupEarnedRaw] = await Promise.all([earnedPromise, groupEarnedPromise]);
    const groupEarned = assertNoPsnError(groupEarnedRaw, `${id} 的奖杯组进度`);
    if (earnedFitsPrevious(previous, earned.trophies, groupEarned)) {
      console.log(JSON.stringify({ event: "playstation-trophy-title", id, reuse: "earned" }));
      return stitchEarned(previous, title, earned, groupEarned);
    }
    const [defs, groupDefs] = await Promise.all([
      fetchTrophyDefinitions(auth, id, opts),
      retryRateLimit(async () =>
        assertNoPsnError(
          await withToken(auth, (token) => getTitleTrophyGroups({ accessToken: token }, id, opts)),
          `${id} 的奖杯组`,
        ),
      ),
    ]);
    console.log(JSON.stringify({ event: "playstation-trophy-title", id, reuse: "fallback" }));
    return assembleTitle(title, defs, earned, groupDefs, groupEarned, previous);
  }

  const [defs, earned, groupDefs, groupEarned] = await Promise.all([
    fetchTrophyDefinitions(auth, id, opts),
    earnedPromise,
    retryRateLimit(async () =>
      assertNoPsnError(
        await withToken(auth, (token) => getTitleTrophyGroups({ accessToken: token }, id, opts)),
        `${id} 的奖杯组`,
      ),
    ),
    groupEarnedPromise,
  ]);
  console.log(JSON.stringify({ event: "playstation-trophy-title", id, reuse: "full" }));
  return assembleTitle(title, defs, earned, groupDefs, groupEarned, previous);
}

async function mapPool<Item, Result>(
  items: Item[],
  concurrency: number,
  fn: (item: Item) => Promise<Result>,
): Promise<Result[]> {
  const out: Result[] = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= items.length) return;
      const item = items[index];
      if (item === undefined) return;
      out[index] = await fn(item);
    }
  }
  const workers = Math.min(Math.max(concurrency, 1), items.length);
  await Promise.all(Array.from({ length: workers }, () => worker()));
  return out;
}

export async function fetchTrophyTitleSlice(
  env: Env,
  auth: AuthSession,
  titles: TitleIndex[],
  previousById: Map<string, TrophyTitleReport>,
): Promise<TrophyTitleReport[]> {
  if (!titles.length) return [];
  return mapPool(titles, TITLE_CRAWL_CONCURRENCY, (title) =>
    fetchTrophyTitle(env, auth, title, previousById.get(title.npCommunicationId)),
  );
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

export type ProfileIdentity = Pick<TrophiesReport["profile"], "onlineId" | "avatarUrl" | "plus">;

export function profileFromSummary(
  identity: ProfileIdentity,
  summary: TrophySummary,
): TrophiesReport["profile"] {
  return {
    onlineId: identity.onlineId,
    avatarUrl: identity.avatarUrl,
    plus: identity.plus,
    level: nonNegativeInt(summary.trophyLevel),
    tier: nonNegativeInt(summary.tier),
    trophyPoint: nonNegative(summary.trophyPoint),
    levelBasePoint: nonNegative(summary.trophyLevelBasePoint),
    levelNextPoint: nonNegative(summary.trophyLevelNextPoint),
    levelProgress: percent(summary.progress),
    earned: counts(summary.earnedTrophies),
  };
}

/** 打 getProfileFromAccountId。要不要打由调用方按 PROFILE_TTL_MS 决定。 */
export async function fetchProfileIdentity(
  env: Env,
  auth: AuthSession,
  summary: TrophySummary,
): Promise<ProfileIdentity> {
  const account = String(summary.accountId ?? "");
  if (!account) throw new Error("奖杯总览没有 accountId");

  const localized = languageHeader(env);
  const headers = localized ? { headerOverrides: localized } : undefined;
  const profile: Loose<ProfileFromAccountIdResponse> = await retryRateLimit(() =>
    withToken(auth, (token) =>
      getProfileFromAccountId({ accessToken: token }, account, headers),
    ),
  );
  const onlineId = trimmed(profile.onlineId);
  if (!onlineId) throw new Error("PSN 资料没有 onlineId");
  return {
    onlineId,
    avatarUrl: profileAvatarUrl(profile.avatars),
    plus: profile.isPlus === true,
  };
}

/**
 * existingProfile 由调用方按 PROFILE_TTL_MS 决定：还新鲜就把
 * onlineId / avatarUrl / plus 传进来，不再打 getProfileFromAccountId；
 * 等级 / 总杯数仍用本轮 summary 覆盖。
 */
export async function buildTrophiesReport(
  env: Env,
  auth: AuthSession,
  summary: TrophySummary,
  titles: TrophyTitleReport[],
  byTrophy: Record<string, PlayedGame[]>,
  existingProfile?: ProfileIdentity | null,
): Promise<TrophiesReport> {
  const linked = applyPlayStats(titles, byTrophy);
  console.log(
    JSON.stringify({
      event: "playstation-trophy-link",
      games: Object.values(byTrophy).reduce((sum, games) => sum + games.length, 0),
      titles: Object.keys(byTrophy).length,
    }),
  );

  const identity = existingProfile ?? (await fetchProfileIdentity(env, auth, summary));
  return {
    observedAt: Date.now(),
    profile: profileFromSummary(identity, summary),
    titles: linked,
  };
}
