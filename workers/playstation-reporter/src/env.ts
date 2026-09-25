export interface Env {
  STATE: KVNamespace;
  PSN_LANGUAGE?: string;
  PSN_ACCOUNT_ID?: string;
  PLAYED_GAMES_LIMIT?: string;
  /** 逗号或空白分隔的 titleId（PPSA… / CUSA…），不上报、不占最近窗口。 */
  PLAYSTATION_HIDDEN_TITLE_IDS?: string;
  /** API Worker 的**源**：人头数拼 `/count`，主机电源拼 `/api/status/playing/now`。 */
  SITE_URL?: string;
  ONLINE_COUNTER_URL?: string;
  /** api Worker 的 PlaystationIngest（Service Binding）。不绑就是 dry-run，只打日志。 */
  API?: Fetcher & { ingest(raw: string): Promise<Response> };
  PSN_NPSSO?: string;
  /** Access 的 team 域名，`/tick` 验 JWT 用。 */
  ACCESS_TEAM_DOMAIN?: string;
  /** 「playstation-reporter tick」这个 Access 应用的 AUD 标签。 */
  ACCESS_AUD?: string;
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

export function isDryRun(env: Env): boolean {
  return !env.API;
}

/** API 的连接数与独立在线人数分别读取。 */
export function countUrl(env: Env): string {
  const origin = env.SITE_URL?.trim();
  return origin ? `${trimSlash(origin)}/count` : "";
}

export function onlineCountUrl(env: Env): string {
  const origin = env.ONLINE_COUNTER_URL?.trim();
  return origin ? `${trimSlash(origin)}/count` : "";
}

/**
 * 主机电源状态挂在「此刻在玩」这条读端点上：Home Assistant 把 PS5 那个开关
 * 上报给 API Worker，读的出口把它并进 presence 一起给出来（见站点 lib/playstation）。
 */
export function playingNowUrl(env: Env): string {
  const origin = env.SITE_URL?.trim();
  return origin ? `${trimSlash(origin)}/api/status/playing/now` : "";
}
