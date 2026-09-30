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
export const FULL_TICK_KEY = "meta:lastFullTick";
export const BACKOFF_UNTIL_KEY = "meta:backoffUntil";
export const FAILURE_STREAK_KEY = "meta:failureStreak";
export const POWER_CLASS_KEY = "meta:lastPower";

export const BACKOFF_BASE_MS = 5 * 60_000;
export const BACKOFF_MAX_MS = 30 * 60_000;

export function backoffMs(streak: number): number {
  const exponent = Math.max(0, Math.min(10, streak - 1));
  return Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** exponent);
}

export type FailureStreak = { streak: number; at: number };

export const PLAYED_GAMES_IDLE_TTL_MS = 60 * 60_000;
export const PLAYED_GAMES_PLAYING_TTL_MS = 29.5 * 60_000;
export const LIBRARY_TTL_MS = 6 * 60 * 60_000;
export const PROFILE_TTL_MS = 24 * 60 * 60_000;

export function profileIdentityFresh(
  profile: { fetchedAt?: number } | null | undefined,
  now = Date.now(),
): boolean {
  const fetchedAt = profile?.fetchedAt;
  return typeof fetchedAt === "number" && Number.isFinite(fetchedAt) && now - fetchedAt < PROFILE_TTL_MS;
}

export type AuthState = {
  accessToken: string;
  refreshToken: string;
  accessTokenIssuedAt: number;
  accessTokenExpiresAt: number;
  refreshTokenIssuedAt: number;
  refreshTokenExpiresAt: number;
};

export type TrophyCatalog = {
  fingerprint: string;
  summarySignature: string;
  index: TrophyIndexSnapshot[];
  titles: TrophiesReport["titles"];
  profile: TrophiesReport["profile"] & {
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
