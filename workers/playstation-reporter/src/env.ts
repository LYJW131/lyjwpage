export interface Env {
  STATE: KVNamespace;
  PSN_LANGUAGE?: string;
  PSN_ACCOUNT_ID?: string;
  PLAYED_GAMES_LIMIT?: string;
  /** 逗号或空白分隔的 titleId（PPSA… / CUSA…），不上报、不占最近窗口。 */
  PLAYSTATION_HIDDEN_TITLE_IDS?: string;
  SITE_URL?: string;
  SITE_INGEST_URL?: string;
  PSN_NPSSO?: string;
  TELEMETRY_INGEST_SECRET?: string;
}

function positiveInteger(raw: string | undefined, fallback: number): number {
  const value = raw?.trim();
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("PLAYED_GAMES_LIMIT 必须是正整数");
  }
  return parsed;
}

export function accountId(env: Env): string {
  return env.PSN_ACCOUNT_ID?.trim() || "me";
}

export function playedGamesLimit(env: Env): number {
  return positiveInteger(env.PLAYED_GAMES_LIMIT, 100);
}

export function hiddenTitleIds(env: Env): Set<string> {
  const raw = env.PLAYSTATION_HIDDEN_TITLE_IDS?.trim() ?? "";
  if (!raw) return new Set();
  return new Set(raw.split(/[,\s]+/).map((id) => id.trim()).filter(Boolean));
}

export function withoutHiddenTitleIds<T extends { titleId: string }>(
  items: T[],
  hidden: Set<string>,
): T[] {
  if (!hidden.size) return items;
  return items.filter((item) => !hidden.has(item.titleId));
}

export function titleIdsHidden(titleIds: readonly string[], hidden: Set<string>): boolean {
  return hidden.size > 0 && titleIds.some((id) => hidden.has(id));
}

export function language(env: Env): string {
  return (env.PSN_LANGUAGE ?? "zh-Hans").trim();
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export function ingestUrl(env: Env): string {
  const explicit = env.SITE_INGEST_URL?.trim();
  if (explicit) return explicit;
  const site = env.SITE_URL?.trim();
  return site ? `${trimSlash(site)}/api/ingest/playstation` : "";
}

export function isDryRun(env: Env): boolean {
  return ingestUrl(env) === "";
}
