import {
  getBasicPresence,
  type BasicPresenceResponse,
  type UserPlayedGamesResponse,
} from "psn-api";

import { AuthSession } from "./auth";
import { accountId, language, playedGamesLimit, type Env } from "./env";

type Loose<T> =
  T extends Array<infer Item>
    ? Array<Loose<Item>>
    : T extends object
      ? { [Key in keyof T]?: Loose<T[Key]> }
      : T;

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
};

export type PlayedGamesReport = {
  observedAt: number;
  items: PlayedGame[];
};

function epochMs(iso: string | undefined): number | null {
  if (!iso) return null;
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : null;
}

function platformName(raw: string | undefined): string | null {
  const value = raw?.trim();
  return value ? value.toUpperCase() : null;
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

function isAccessTokenRejected(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /(?:\b401\b|\bunauthori[sz]ed\b|access token.+(?:expired|invalid)|(?:expired|invalid).+access token)/i.test(
    error.message,
  );
}

/** 业务请求遇到 401 时强制续期一次，并且只重试一次。 */
async function withToken<T>(
  auth: AuthSession,
  load: (token: string) => Promise<T>,
): Promise<T> {
  try {
    return await load(await auth.accessToken());
  } catch (error) {
    if (!isAccessTokenRejected(error)) throw error;
    return load(await auth.accessToken(true));
  }
}

function languageHeader(env: Env): { "Accept-Language": string } | undefined {
  const value = language(env);
  return value ? { "Accept-Language": value } : undefined;
}

export async function fetchPresence(env: Env, auth: AuthSession): Promise<PresenceReport> {
  const localized = languageHeader(env);
  const raw = (await withToken(auth, (token) =>
    getBasicPresence(
      { accessToken: token },
      accountId(env),
      localized ? { headerOverrides: localized } : undefined,
    ),
  )) as Loose<BasicPresenceResponse>;

  const presence = raw.basicPresence;
  const primary = presence?.primaryPlatformInfo;
  const title = presence?.gameTitleInfoList?.[0];
  return {
    observedAt: Date.now(),
    online: primary?.onlineStatus === "online",
    availability: presence?.availability?.trim() || null,
    platform: platformName(primary?.platform),
    lastOnlineAt: epochMs(primary?.lastOnlineDate),
    playing:
      title?.npTitleId && title.titleName
        ? {
            titleId: title.npTitleId,
            title: title.titleName,
            format: platformName(title.format),
            launchPlatform: platformName(title.launchPlatform),
            iconUrl: title.npTitleIconUrl?.trim() || title.conceptIconUrl?.trim() || null,
          }
        : null,
  };
}

/**
 * psn-api 2.18.1 的 getUserPlayedGames 不接 headerOverrides，实现也不发语言头，
 * 因而这一个请求继续直打与它相同的端点，保住官方中文游戏名。
 */
const USER_GAMES_BASE_URL = "https://m.np.playstation.com/api/gamelist/v2/users";

async function requestPlayedGames(
  env: Env,
  token: string,
): Promise<Loose<UserPlayedGamesResponse>> {
  const id = encodeURIComponent(accountId(env));
  const response = await fetch(
    `${USER_GAMES_BASE_URL}/${id}/titles?limit=${playedGamesLimit(env)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        ...languageHeader(env),
      },
    },
  );
  if (!response.ok) {
    const body = (await response.text().catch(() => "")).slice(0, 200);
    throw new Error(`PSN 返回 ${response.status}：${body}`);
  }
  return (await response.json()) as Loose<UserPlayedGamesResponse>;
}

export async function fetchPlayedGames(
  env: Env,
  auth: AuthSession,
): Promise<PlayedGamesReport> {
  const raw = await withToken(auth, (token) => requestPlayedGames(env, token));
  const items: PlayedGame[] = [];
  for (const title of raw.titles ?? []) {
    if (!title?.titleId) continue;
    items.push({
      titleId: title.titleId,
      name: title.name?.trim() || title.localizedName?.trim() || "",
      category: title.category?.trim() || null,
      playCount: Number(title.playCount) || 0,
      firstPlayedAt: epochMs(title.firstPlayedDateTime),
      lastPlayedAt: epochMs(title.lastPlayedDateTime),
      playDurationMs: durationMs(title.playDuration),
      imageUrl: title.imageUrl?.trim() || title.localizedImageUrl?.trim() || null,
    });
  }
  return { observedAt: Date.now(), items: items.slice(0, playedGamesLimit(env)) };
}
