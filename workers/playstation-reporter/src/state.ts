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
/**
 * 上一轮完整 tick 的**开始**时刻，门用它算间隔。
 *
 * 和 `meta:lastTick` 分开是因为那份只在 tick 收尾时写：tick 被 CPU 超时之类
 * 硬杀掉就永远不会落地，门读到的还是上上轮，于是每分钟重试一次。这个键在跑
 * PSN 之前就写，所以记的是「尝试过」而不是「成功过」—— 上游持续故障时的重试
 * 节奏跟着基线走，和从前的 15 分钟一轮一样。
 */
export const FULL_TICK_KEY = "meta:lastFullTick";

/** 没在玩时游玩列表最多这么旧才去翻。 */
export const PLAYED_GAMES_IDLE_TTL_MS = 60 * 60_000;
/**
 * 在玩时的游玩列表 TTL，对应闲时那档 15 分钟的完整 tick 节奏。
 *
 * 从前是「在玩就每轮刷」，那时一轮就是 15 分钟，两者等价。cron 提到每分钟、
 * 有人看站点时 60 秒一轮之后，「每轮刷」会变成每分钟翻一遍分页列表 ——
 * 时长和游玩次数没有分钟级精度可言。
 *
 * 写 14.5 而不是 15，和门的阈值是同一个取整余量，但成因不同：`fetchedAt` 盖的是
 * 列表**拉完**的时刻，门锚的却是 tick **开始**的时刻，所以下一轮查新鲜度时算出来的
 * 年龄是「15 分钟 − 上一轮翻列表花的时间」，卡 15 整会稳定地差一点点、把刷新推到
 * 再下一轮去（在玩且没人看时就成了 30 分钟一刷）。让一档 30 秒的余量把它兜住：
 * 快慢两种节奏下第一个够格的都正好是第 15 分钟那一轮。
 */
export const PLAYED_GAMES_PLAYING_TTL_MS = 14.5 * 60_000;
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

/** 读不到、读到脏值都当 0：门会认为「从没跑过」，于是立刻放行一轮完整 tick。 */
export async function readFullTickStartedAt(state: KVNamespace): Promise<number> {
  const raw = await state.get(FULL_TICK_KEY);
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export async function writeFullTickStartedAt(state: KVNamespace, startedAt: number): Promise<void> {
  await state.put(FULL_TICK_KEY, String(startedAt));
}

export function pastHalfLife(issuedAt: number, expiresAt: number, now = Date.now()): boolean {
  if (!(expiresAt > issuedAt)) return true;
  return now >= issuedAt + (expiresAt - issuedAt) / 2;
}
