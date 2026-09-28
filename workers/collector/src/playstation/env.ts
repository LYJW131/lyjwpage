import type { StateCoreRpc } from "@shared/state-core";

/**
 * PlayStation 这条线用到的绑定与变量；采集 Worker 的 Env 是它的超集。
 * CORE 只挑这里用到的三个方法，测试替身照这个形状写就够。
 */
export interface Env {
  /** 采集 Worker 私有 KV：PSN 登录、指纹、目录与游玩列表缓存、门和退避的时间戳 */
  COLLECTOR_KV: KVNamespace;
  /** 状态核心：上报、推送连接数、主机电源 */
  CORE: Pick<StateCoreRpc, "ingest" | "connections" | "playstationPower">;
  /** 长期归档；不绑就不归档奖杯 */
  HISTORY?: D1Database;
  PSN_LANGUAGE?: string;
  PSN_ACCOUNT_ID?: string;
  PLAYED_GAMES_LIMIT?: string;
  /** 逗号或空白分隔的 titleId（PPSA… / CUSA…），不上报、不占最近窗口。 */
  PLAYSTATION_HIDDEN_TITLE_IDS?: string;
  ONLINE_COUNTER_URL?: string;
  /** "true" 时信封只打进日志，不交给状态核心 */
  PS_DRY_RUN?: string;
  PSN_NPSSO?: string;
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
  return env.PS_DRY_RUN?.trim() === "true";
}

export function onlineCountUrl(env: Env): string {
  const origin = env.ONLINE_COUNTER_URL?.trim();
  return origin ? `${trimSlash(origin)}/count` : "";
}
