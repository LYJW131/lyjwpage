import type { PlayedGame } from "./psn";
import type { TrophiesReport } from "./trophies";

export const AUTH_KEY = "auth";
export const PLAYED_GAMES_FINGERPRINT_KEY = "fp:playedGames";
export const TROPHIES_FINGERPRINT_KEY = "fp:trophies";
export const TROPHY_SYNC_KEY = "trophySync";
export const TICK_META_KEY = "meta:lastTick";

/** KV `auth` 的形状与原 `state/auth.json` 完全一致，便于直接迁移现有状态。 */
export type AuthState = {
  accessToken: string;
  refreshToken: string;
  accessTokenIssuedAt: number;
  accessTokenExpiresAt: number;
  refreshTokenIssuedAt: number;
  refreshTokenExpiresAt: number;
};

export type TrophySyncProgress = {
  done: number;
  total: number;
};

/** 分片爬取的游标。站点只收整份目录，这里只存还没交付的半成品。 */
export type TrophySyncState = {
  targetFingerprint: string;
  titleIds: string[];
  nextIndex: number;
  titles: TrophiesReport["titles"];
  /** 标题爬完之后才有：titleId 对齐也按预算切开，避免组装轮顶满 50。 */
  playLink?: {
    games: PlayedGame[];
    offset: number;
    byTrophy: Record<string, PlayedGame[]>;
  };
};

/** presence 每轮必发，没有「变没变」可言，所以只记另外两部分。 */
export type TickMeta = {
  startedAt: number;
  completedAt: number;
  ok: boolean;
  playedGamesChanged: boolean;
  trophiesChanged: boolean;
  dryRun: boolean;
  trophySync?: TrophySyncProgress;
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

function isPlayLink(value: unknown): value is NonNullable<TrophySyncState["playLink"]> {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    Array.isArray(row.games) &&
    typeof row.offset === "number" &&
    Number.isInteger(row.offset) &&
    row.offset >= 0 &&
    typeof row.byTrophy === "object" &&
    row.byTrophy !== null &&
    row.offset <= row.games.length
  );
}

export function asTrophySync(value: unknown): TrophySyncState | null {
  if (typeof value !== "object" || value === null) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.targetFingerprint !== "string" || !row.targetFingerprint) return null;
  if (!Array.isArray(row.titleIds) || !row.titleIds.every((id) => typeof id === "string" && id)) {
    return null;
  }
  if (typeof row.nextIndex !== "number" || !Number.isInteger(row.nextIndex) || row.nextIndex < 0) {
    return null;
  }
  if (!Array.isArray(row.titles) || row.titles.length !== row.nextIndex) return null;
  if (row.nextIndex > row.titleIds.length) return null;
  if (row.playLink !== undefined && !isPlayLink(row.playLink)) return null;
  return {
    targetFingerprint: row.targetFingerprint,
    titleIds: row.titleIds,
    nextIndex: row.nextIndex,
    titles: row.titles as TrophiesReport["titles"],
    ...(row.playLink ? { playLink: row.playLink } : {}),
  };
}

export async function readAuth(state: KVNamespace): Promise<AuthState | null> {
  const value = await state.get<unknown>(AUTH_KEY, "json");
  return isAuthState(value) ? value : null;
}

export async function writeAuth(state: KVNamespace, auth: AuthState): Promise<void> {
  await state.put(AUTH_KEY, JSON.stringify(auth));
}

export async function writeTrophySync(state: KVNamespace, sync: TrophySyncState): Promise<void> {
  await state.put(TROPHY_SYNC_KEY, JSON.stringify(sync));
}

export async function clearTrophySync(state: KVNamespace): Promise<void> {
  await state.delete(TROPHY_SYNC_KEY);
}

export function pastHalfLife(issuedAt: number, expiresAt: number, now = Date.now()): boolean {
  if (!(expiresAt > issuedAt)) return true;
  return now >= issuedAt + (expiresAt - issuedAt) / 2;
}
