export const AUTH_KEY = "auth";
export const PRESENCE_FINGERPRINT_KEY = "fp:presence";
export const PLAYED_GAMES_FINGERPRINT_KEY = "fp:playedGames";
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

export type TickMeta = {
  startedAt: number;
  completedAt: number;
  ok: boolean;
  presenceChanged: boolean;
  playedGamesChanged: boolean;
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

export async function readAuth(state: KVNamespace): Promise<AuthState | null> {
  const value = await state.get<unknown>(AUTH_KEY, "json");
  return isAuthState(value) ? value : null;
}

export async function writeAuth(state: KVNamespace, auth: AuthState): Promise<void> {
  await state.put(AUTH_KEY, JSON.stringify(auth));
}

export function pastHalfLife(issuedAt: number, expiresAt: number, now = Date.now()): boolean {
  if (!(expiresAt > issuedAt)) return true;
  return now >= issuedAt + (expiresAt - issuedAt) / 2;
}
