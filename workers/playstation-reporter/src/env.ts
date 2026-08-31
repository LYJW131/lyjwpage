export interface Env {
  STATE: KVNamespace;
  PSN_LANGUAGE?: string;
  PSN_ACCOUNT_ID?: string;
  PLAYED_GAMES_LIMIT?: string;
  /** 逗号或空白分隔的 titleId（PPSA… / CUSA…），不上报、不占最近窗口。 */
  PLAYSTATION_HIDDEN_TITLE_IDS?: string;
  SITE_URL?: string;
  SITE_INGEST_URL?: string;
  /** online-counter worker 的**源**，路径由这边拼，和站点侧那个变量同一个形状。 */
  ONLINE_COUNTER_URL?: string;
  /** live-push worker 的**源**，同样拼 `/count`。数的是「开着」，不是「可见」。 */
  LIVE_PUSH_URL?: string;
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
  let end = url.length;
  while (end > 0 && url[end - 1] === "/") end -= 1;
  return url.slice(0, end);
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

/**
 * 两个人头数的读取地址。没配就返回空串 —— 门会按「没人」走，对应那一档用不上，
 * 不会因为少配一个变量而变快。
 *
 * online-counter 数的是**此刻可见**的页面，live-push 数的是**开着**的（含后台
 * 标签页、锁了屏的手机）：站点侧 use-online-count 在页面不可见时把连接整条关掉，
 * use-live-events 那条不关。
 */
export function onlineCountUrl(env: Env): string {
  const origin = env.ONLINE_COUNTER_URL?.trim();
  return origin ? `${trimSlash(origin)}/count` : "";
}

export function openCountUrl(env: Env): string {
  const origin = env.LIVE_PUSH_URL?.trim();
  return origin ? `${trimSlash(origin)}/count` : "";
}
