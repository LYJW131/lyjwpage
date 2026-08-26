import type { LibraryTitle, PlayedGame, PlayedGamesReport } from "./psn";
import type { TrophiesReport, TrophyIndexSnapshot } from "./trophies";

export const AUTH_KEY = "auth";
export const PLAYED_GAMES_FINGERPRINT_KEY = "fp:playedGames";
export const TROPHIES_FINGERPRINT_KEY = "fp:trophies";
/** 免费版分片游标的残留键。付费后一轮爬完，tick 开头删掉。 */
export const TROPHY_SYNC_KEY = "trophySync";
export const TROPHY_CATALOG_KEY = "trophies:last";
export const PLAYED_GAMES_CACHE_KEY = "cache:playedGames";
export const LIBRARY_CACHE_KEY = "cache:library";
export const TICK_META_KEY = "meta:lastTick";

/** 没在玩时游玩列表最多这么旧才去翻；正在玩的每轮都刷新。 */
export const PLAYED_GAMES_TTL_MS = 60 * 60_000;
/** 购买库几乎不动，六小时够标一次预购 / Plus。 */
export const LIBRARY_TTL_MS = 6 * 60 * 60_000;

/** KV `auth` 的形状与原 `state/auth.json` 完全一致，便于直接迁移现有状态。 */
export type AuthState = {
  accessToken: string;
  refreshToken: string;
  accessTokenIssuedAt: number;
  accessTokenExpiresAt: number;
  refreshTokenIssuedAt: number;
  refreshTokenExpiresAt: number;
};

/** 上次成功交付的整份目录。增量重爬的对照面，站点收的仍是整份替换。 */
export type TrophyCatalog = {
  fingerprint: string;
  summarySignature: string;
  index: TrophyIndexSnapshot[];
  titles: TrophiesReport["titles"];
  profile: TrophiesReport["profile"];
};

export type PlayedGamesCache = {
  fetchedAt: number;
  report: PlayedGamesReport;
};

export type LibraryCache = {
  fetchedAt: number;
  items: LibraryTitle[];
};

/** presence 每轮必发，没有「变没变」可言，所以只记另外两部分。 */
export type TickMeta = {
  startedAt: number;
  completedAt: number;
  ok: boolean;
  playedGamesChanged: boolean;
  trophiesChanged: boolean;
  dryRun: boolean;
  error?: string;
};

function isAuthState(value: unknown): value is AuthState {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  const strings = ["accessToken", "refreshToken"] as const;
  const numbers = [
    "accessTokenIssuedAt",
    "accessTokenExpiresAt",
    "refreshTokenIssuedAt",
    "refreshTokenExpiresAt",
  ] as const;
  return (
    strings.every((key) => typeof row[key] === "string" && row[key] !== "") &&
    numbers.every((key) => typeof row[key] === "number" && Number.isFinite(row[key]))
  );
}

function isIndexSnapshot(value: unknown): value is TrophyIndexSnapshot {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.npCommunicationId === "string" &&
    row.npCommunicationId.length > 0 &&
    typeof row.progress === "number" &&
    typeof row.lastUpdatedDateTime === "string" &&
    typeof row.earned === "object" &&
    row.earned !== null &&
    typeof row.defined === "object" &&
    row.defined !== null
  );
}

function isTrophyProfile(value: unknown): value is TrophiesReport["profile"] {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return typeof row.onlineId === "string" && row.onlineId.length > 0 && typeof row.plus === "boolean";
}

export function asTrophyCatalog(value: unknown): TrophyCatalog | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.fingerprint !== "string" || !row.fingerprint) return null;
  if (typeof row.summarySignature !== "string" || !row.summarySignature) return null;
  if (!Array.isArray(row.index) || !row.index.every(isIndexSnapshot)) return null;
  if (!Array.isArray(row.titles)) return null;
  if (!isTrophyProfile(row.profile)) return null;
  return {
    fingerprint: row.fingerprint,
    summarySignature: row.summarySignature,
    index: row.index,
    titles: row.titles as TrophiesReport["titles"],
    profile: row.profile,
  };
}

function isPlayedGame(value: unknown): value is PlayedGame {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return typeof row.titleId === "string" && row.titleId.length > 0 && typeof row.name === "string";
}

export function asPlayedGamesCache(value: unknown): PlayedGamesCache | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.fetchedAt !== "number" || !Number.isFinite(row.fetchedAt)) return null;
  if (typeof row.report !== "object" || row.report === null) return null;
  const report = row.report as Record<string, unknown>;
  if (typeof report.observedAt !== "number" || !Array.isArray(report.items)) return null;
  if (!report.items.every(isPlayedGame)) return null;
  return {
    fetchedAt: row.fetchedAt,
    report: { observedAt: report.observedAt, items: report.items },
  };
}

function isLibraryTitle(value: unknown): value is LibraryTitle {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return typeof row.titleId === "string" && row.titleId.length > 0;
}

export function asLibraryCache(value: unknown): LibraryCache | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.fetchedAt !== "number" || !Number.isFinite(row.fetchedAt)) return null;
  if (!Array.isArray(row.items) || !row.items.every(isLibraryTitle)) return null;
  return { fetchedAt: row.fetchedAt, items: row.items };
}

export async function readAuth(state: KVNamespace): Promise<AuthState | null> {
  const value = await state.get<unknown>(AUTH_KEY, "json");
  return isAuthState(value) ? value : null;
}

export async function writeAuth(state: KVNamespace, auth: AuthState): Promise<void> {
  await state.put(AUTH_KEY, JSON.stringify(auth));
}

export async function writeTrophyCatalog(state: KVNamespace, catalog: TrophyCatalog): Promise<void> {
  await state.put(TROPHY_CATALOG_KEY, JSON.stringify(catalog));
}

export async function writePlayedGamesCache(state: KVNamespace, cache: PlayedGamesCache): Promise<void> {
  await state.put(PLAYED_GAMES_CACHE_KEY, JSON.stringify(cache));
}

export async function writeLibraryCache(state: KVNamespace, cache: LibraryCache): Promise<void> {
  await state.put(LIBRARY_CACHE_KEY, JSON.stringify(cache));
}

export function pastHalfLife(issuedAt: number, expiresAt: number, now = Date.now()): boolean {
  if (!(expiresAt > issuedAt)) return true;
  return now >= issuedAt + (expiresAt - issuedAt) / 2;
}
