import type { VibeCodingLimit } from "./types.ts";

const SESSION_WINDOW_MAX_MINUTES = 1440;

export function windowMatchesName(limit: VibeCodingLimit, name: string): boolean {
  return `${limit.key} ${limit.label ?? ""}`.toLowerCase().includes(name);
}

function isSparkWindow(limit: VibeCodingLimit): boolean {
  return windowMatchesName(limit, "spark") || windowMatchesName(limit, "bengalfox");
}

export function isExtraAccountWindow(limit: VibeCodingLimit): boolean {
  return isSparkWindow(limit) || limit.key.includes("weekly-scoped") || windowMatchesName(limit, "fable");
}

function isSessionWindow(limit: VibeCodingLimit): boolean {
  return (
    limit.group === "session" ||
    (limit.windowMinutes != null && limit.windowMinutes < SESSION_WINDOW_MAX_MINUTES)
  );
}

export function accountWindowSlot(limit: VibeCodingLimit): "session" | "weekly" | null {
  if (isExtraAccountWindow(limit)) return null;
  return isSessionWindow(limit) ? "session" : "weekly";
}

export function busiestAccountWindow(limits: readonly VibeCodingLimit[], now: number): VibeCodingLimit | null {
  const candidates = limits.filter((limit) => !isExtraAccountWindow(limit));
  if (candidates.length === 0) return null;
  const effective = (limit: VibeCodingLimit) =>
    now && limit.resetsAt != null && limit.resetsAt * 1000 <= now ? 0 : limit.usedPercent;
  return candidates.reduce((best, row) => (effective(row) > effective(best) ? row : best));
}
