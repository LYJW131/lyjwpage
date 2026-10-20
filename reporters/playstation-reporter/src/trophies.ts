import { getProfileFromAccountId, getUserTitles, getUserTrophyProfileSummary, type ProfileFromAccountIdResponse, type TrophyTitle, type UserTitlesResponse } from "psn-api";

import { AuthSession } from "./auth.js";
import { type Env } from "./env.js";
import { type PlayedGame } from "./psn.js";
import { counts, countsEqual, type TitleIndex, type TrophiesReport, type TrophyCounts, type TrophyIndexSnapshot, type TrophySummary, type TrophyTitleReport } from "./trophy-model.js";
import { applyPlayStats } from "./trophy-play.js";
import { collectPages, PAGE_LIMIT } from "./trophy-titles.js";
import { assertNoPsnError, languageHeader, nonNegative, nonNegativeInt, percent, retryRateLimit, trimmed, withToken, type Loose } from "./util.js";

export { countsEqual, type TitleIndex, type TrophiesReport, type TrophyCounts, type TrophyIndexSnapshot, type TrophySummary, type TrophyTitleReport, type TrophyType } from "./trophy-model.js";
export { applyPlayStats, mapPlayByTrophy, mergePlayByTrophy, playByTrophyFromTitles, playLinkGames } from "./trophy-play.js";
export { canReuseDefinitions, fetchTrophyTitleSlice } from "./trophy-titles.js";

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
