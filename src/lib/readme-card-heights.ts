import { usableCardKinds, weeklyLimit } from "@/components/live/vibecoding/limits";
import type { CodingAgentRow } from "@/lib/coding-agents";
import { forecastLimit } from "@/lib/limit-forecast";
import { AGENT_LIMITS_STALE_MS, clockReading } from "@shared/freshness";
import type { LimitHistoryPayload } from "@shared/limit-history";
import type { TrophyTitle } from "@shared/types";
import type { ClaudeResetCards } from "@shared/vibecoding-limits";

// Vibe Coding 卡底部每个 compact 代理占一行，行数跟着上报的代理变；按 FULL_WIDTH 在浏览器里量得。
// 须与 src/components/live/vibecoding/compact-agents.tsx 的行高同步。
export const COMPACT_AGENT_ROW_PX = 57;
export const VIBE_CODING_BASE_HEIGHT = 724;
// 重置卡按钮组一行加上方 gap-3；须与 src/components/live/vibecoding/agent-panel.tsx 的摘要区排版同步。
export const RESET_CARD_TOGGLE_PX = 38;

export const PLAYSTATION_BASE_HEIGHT = 835;
// 展开的游戏有多个奖杯分组（DLC）时多出 GroupSlot 一行；须与 src/components/trophies/trophy-details.tsx#GroupSlot 同步。
export const TROPHY_GROUPS_STRIP_PX = 49;

export function vibeCodingCardHeight({
  rows,
  history,
  resetCards,
  now,
  limitsServedAt,
}: {
  rows: readonly CodingAgentRow[];
  history: LimitHistoryPayload | null;
  resetCards: ClaudeResetCards | null;
  now: number;
  limitsServedAt?: number;
}): number {
  const claude = rows.find((row) => row.id === "claude");
  const clock = clockReading(0, now, limitsServedAt);
  const claudeLimitsStale = claude?.limitsAt != null && clock - claude.limitsAt > AGENT_LIMITS_STALE_MS;
  const limit = claude && !claudeLimitsStale ? weeklyLimit(claude) : null;
  const points = history?.series.find((series) => series.agent === "claude" && series.key === limit?.key)?.points ?? [];
  const forecast = limit && clock ? forecastLimit(limit, points, Math.min(clock, claude?.limitsAt ?? clock)) : null;
  const resetCardToggleShown = !!claude && forecast != null && usableCardKinds(claude.limits, resetCards).length > 0;
  return (
    VIBE_CODING_BASE_HEIGHT
    + rows.filter((row) => row.row === "compact").length * COMPACT_AGENT_ROW_PX
    + (resetCardToggleShown ? RESET_CARD_TOGGLE_PX : 0)
  );
}

export function playstationCardHeight(titles: readonly Pick<TrophyTitle, "groups">[] | null | undefined): number {
  const hasGroups = Boolean(titles?.some((title) => title.groups.length > 1));
  return PLAYSTATION_BASE_HEIGHT + (hasGroups ? TROPHY_GROUPS_STRIP_PX : 0);
}
