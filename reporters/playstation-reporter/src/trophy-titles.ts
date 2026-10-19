import {
  getTitleTrophies,
  getTitleTrophyGroups,
  getUserTrophiesEarnedForTitle,
  getUserTrophyGroupEarningsForTitle,
  type TitleThinTrophy,
  type TitleTrophiesResponse,
  type TitleTrophyGroupsResponse,
  type Trophy as PsnTrophy,
  type UserThinTrophy,
  type UserTrophiesEarnedForTitleResponse,
  type UserTrophyGroupEarningsForTitleResponse,
} from "psn-api";

import { AuthSession } from "./auth.js";
import { type Env } from "./env.js";
import { counts, countsEqual, isTrophyType, rate, type TitleIndex, type TrophyTitleReport } from "./trophy-model.js";
import { assertNoPsnError, epochMs, languageHeader, nonNegativeInt, percent, retryRateLimit, trimmed, withToken, type Loose } from "./util.js";

// psn-api 的定义类型漏了已获得响应中的稀有度字段。
type DefinedTrophy = Loose<TitleThinTrophy & Pick<PsnTrophy, "trophyEarnedRate">>;

type EarnedTrophy = Loose<
  UserThinTrophy & Pick<TitleThinTrophy, "trophyName" | "trophyDetail" | "trophyIconUrl">
>;

type TrophyGroupDefinition = NonNullable<Loose<TitleTrophyGroupsResponse>["trophyGroups"]>[number];
type TrophyGroupEarnings = NonNullable<
  Loose<UserTrophyGroupEarningsForTitleResponse>["trophyGroups"]
>[number];

function titleOptions(env: Env, platform: string | undefined) {
  const localized = languageHeader(env);
  return {
    ...(platform?.includes("PS5") ? {} : { npServiceName: "trophy" as const }),
    ...(localized ? { headerOverrides: localized } : {}),
  };
}

type TitleOptions = ReturnType<typeof titleOptions>;

const TITLE_CRAWL_CONCURRENCY = 2;
export const PAGE_LIMIT = 100;
const MAX_PAGES = 100;

type PsnPage<Row> = {
  rows: Row[] | undefined;
  nextOffset: number | undefined;
  totalItemCount: number | undefined;
};

// 截断目录会被误认为真实删减并写入指纹，必须在缓存前核对总条数。
export async function collectPages<Row>(
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
    if (next == null || next <= offset) break;
    if (total != null && rows.length >= total) break;
    offset = next;
  }
  if (total != null && rows.length !== total) {
    throw new Error(`PSN ${what} 只取到 ${rows.length} / ${total} 条`);
  }
  return rows;
}

export function canReuseDefinitions(
  previous: TrophyTitleReport | undefined,
  row: TitleIndex,
): boolean {
  if (!previous?.trophies.length || !previous.groups.length) return false;
  return countsEqual(previous.defined, counts(row.definedTrophies));
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
