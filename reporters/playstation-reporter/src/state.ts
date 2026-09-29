import type { PowerClass } from "./cadence.js";
import type { LibraryTitle, PlayedGame, PlayedGamesReport } from "./psn.js";
import type { StateStore } from "./store.js";
import type { TrophiesReport, TrophyIndexSnapshot } from "./trophies.js";

export const AUTH_KEY = "auth";
export const PLAYED_GAMES_FINGERPRINT_KEY = "fp:playedGames";
export const TROPHIES_FINGERPRINT_KEY = "fp:trophies";
export const TROPHY_CATALOG_KEY = "trophies:last";
export const PLAYED_GAMES_CACHE_KEY = "cache:playedGames";
export const LIBRARY_CACHE_KEY = "cache:library";
export const TICK_META_KEY = "meta:lastTick";
/**
 * 上一轮完整 tick 的**开始**时刻，门用它算间隔。
 *
 * 和 `meta:lastTick` 分开是因为那份只在 tick 收尾时写：进程在中途被杀掉就不会落地，
 * 门读到的还是上上轮。这个键在打 PSN 之前就写，所以记的是「尝试过」而不是「成功过」
 * —— 上游持续故障时的重试节奏跟着基线走。进程里另有一份，盖住「写了还没读回来」。
 */
export const FULL_TICK_KEY = "meta:lastFullTick";
/**
 * PSN 上游不可用（Akamai 拒绝页、网关 5xx）之后，到这个时刻之前不再开跑。
 * 纯数字 epoch 毫秒，和 `meta:lastFullTick` 同一种写法；成功一轮就清成 0。
 */
export const BACKOFF_UNTIL_KEY = "meta:backoffUntil";
/** 连着失败了几轮（不分原因）和最后一次更新的时刻；成功一轮归零 */
export const FAILURE_STREAK_KEY = "meta:failureStreak";
/** 上一轮 tick 开始时的调频档：`awake` 或 `resting`。用来发现醒着和没醒对调。 */
export const POWER_CLASS_KEY = "meta:lastPower";

/** 退避从 `BACKOFF_BASE_MS` 起，每连败一轮翻倍，封顶 `BACKOFF_MAX_MS`（量级和闲档那一轮相当） */
export const BACKOFF_BASE_MS = 5 * 60_000;
export const BACKOFF_MAX_MS = 30 * 60_000;

export function backoffMs(streak: number): number {
  const exponent = Math.max(0, Math.min(10, streak - 1));
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** exponent);
}

export type FailureStreak = { streak: number; at: number };

/** 没在玩时游玩列表最多这么旧才去翻。 */
export const PLAYED_GAMES_IDLE_TTL_MS = 60 * 60_000;
/**
 * 在玩时的游玩列表 TTL，对应闲档的完整 tick 节奏（cadence.ts 的 `IDLE_TICK_INTERVAL_MS`）。
 *
 * 列表刷新和 tick 分开排：快档下「在玩就每轮刷」会变成每分钟翻一遍分页列表，
 * 而时长和游玩次数没有分钟级精度可言。
 *
 * 取值比闲档间隔略短，和门的阈值是同一个取整余量，但成因不同：`fetchedAt` 盖的是
 * 列表**拉完**的时刻，门锚的却是 tick **开始**的时刻，所以下一轮查新鲜度时算出来的
 * 年龄是「闲档间隔 − 上一轮翻列表花的时间」，卡整数会稳定地差一点点、把刷新推到
 * 再下一轮去。留一点余量把它兜住：快慢两种节奏下第一个够格的都正好是闲档那一轮。
 */
export const PLAYED_GAMES_PLAYING_TTL_MS = 29.5 * 60_000;
/** 购买库几乎不动，隔这么久标一次预购 / Plus 就够。 */
export const LIBRARY_TTL_MS = 6 * 60 * 60_000;
/**
 * 头像 / 网名 / Plus 几乎不怎么变，隔这么久拉一次就够。
 *
 * 资料和奖杯目录解耦：还新鲜就沿用 onlineId / avatarUrl / plus（等级 / 总杯数仍用
 * 本轮 summary 盖），dirty 重爬时也不再重打；过期了 quiet 也要重拉，否则站点上的头像
 * 会一直停在第一次 dirty 时那张。
 *
 * 缺 fetchedAt 的当过期，下一轮重拉。
 */
export const PROFILE_TTL_MS = 24 * 60 * 60_000;

/** 缺席、非数字、过期，都要重拉资料。 */
export function profileIdentityFresh(
  profile: { fetchedAt?: number } | null | undefined,
  now = Date.now(),
): boolean {
  const fetchedAt = profile?.fetchedAt;
  return typeof fetchedAt === "number" && Number.isFinite(fetchedAt) && now - fetchedAt < PROFILE_TTL_MS;
}

/** `AUTH_KEY` 里存的登录状态，读写见 `readAuth` / `writeAuth`。 */
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
  profile: TrophiesReport["profile"] & {
    /** 上次打 getProfileFromAccountId 的时刻。缺席当过期。 */
    fetchedAt?: number;
  };
};

export type PlayedGamesCache = {
  fetchedAt: number;
  report: PlayedGamesReport;
};

export type LibraryCache = {
  fetchedAt: number;
  items: LibraryTitle[];
};

/** presence 每个完整 tick 必发，没有「变没变」可言，所以只记另外两部分。 */
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

function isTrophyProfile(value: unknown): value is TrophyCatalog["profile"] {
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

export async function readAuth(state: StateStore): Promise<AuthState | null> {
  const value = await state.get(AUTH_KEY, "json");
  return isAuthState(value) ? value : null;
}

export async function writeAuth(state: StateStore, auth: AuthState): Promise<void> {
  await state.put(AUTH_KEY, JSON.stringify(auth));
}

export async function writeTrophyCatalog(state: StateStore, catalog: TrophyCatalog): Promise<void> {
  await state.put(TROPHY_CATALOG_KEY, JSON.stringify(catalog));
}

export async function writePlayedGamesCache(state: StateStore, cache: PlayedGamesCache): Promise<void> {
  await state.put(PLAYED_GAMES_CACHE_KEY, JSON.stringify(cache));
}

export async function writeLibraryCache(state: StateStore, cache: LibraryCache): Promise<void> {
  await state.put(LIBRARY_CACHE_KEY, JSON.stringify(cache));
}

/** 读不到、读到脏值都当 0：门会认为「从没跑过」，于是立刻放行一轮完整 tick。 */
export async function readFullTickStartedAt(state: StateStore): Promise<number> {
  const raw = await state.get(FULL_TICK_KEY);
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export async function writeFullTickStartedAt(state: StateStore, startedAt: number): Promise<void> {
  await state.put(FULL_TICK_KEY, String(startedAt));
}

export async function readBackoffUntil(state: StateStore): Promise<number> {
  const value = Number(await state.get(BACKOFF_UNTIL_KEY));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

export async function writeBackoffUntil(state: StateStore, until: number): Promise<void> {
  await state.put(BACKOFF_UNTIL_KEY, String(until));
}

export async function readFailureStreak(state: StateStore): Promise<FailureStreak> {
  const value = await state.get(FAILURE_STREAK_KEY, "json").catch(() => null);
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const streak = Number(row?.streak);
  const at = Number(row?.at);
  return Number.isSafeInteger(streak) && streak >= 0 && Number.isFinite(at) ? { streak, at } : { streak: 0, at: 0 };
}

export async function writeFailureStreak(state: StateStore, value: FailureStreak): Promise<void> {
  await state.put(FAILURE_STREAK_KEY, JSON.stringify(value));
}

export async function readPowerClass(state: StateStore): Promise<PowerClass | null> {
  const raw = await state.get(POWER_CLASS_KEY);
  return raw === "awake" || raw === "resting" ? raw : null;
}

export async function writePowerClass(state: StateStore, value: PowerClass): Promise<void> {
  await state.put(POWER_CLASS_KEY, value);
}

export function pastHalfLife(issuedAt: number, expiresAt: number, now = Date.now()): boolean {
  if (!(expiresAt > issuedAt)) return true;
  return now >= issuedAt + (expiresAt - issuedAt) / 2;
}
