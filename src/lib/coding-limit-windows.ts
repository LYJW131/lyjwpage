import type { VibeCodingLimit } from "./types.ts";

const FIVE_HOUR_MINUTES = 300;
const WEEK_MINUTES = 10_080;
const DAY_MINUTES = 1440;

function named(limit: Pick<VibeCodingLimit, "key" | "label">, name: string) {
  return `${limit.key} ${limit.label ?? ""}`.toLowerCase().includes(name);
}

// cursor.tertiary 在全量面板里单独成行。凡是 .tertiary 都当专项，会把 Antigravity 的 Claude & GPT 周额度从紧凑行的最忙窗口里拿掉。
export function isExtraLimitWindow(limit: VibeCodingLimit): boolean {
  return (
    limit.key === "cursor.tertiary" ||
    named(limit, "spark") ||
    named(limit, "bengalfox") ||
    limit.key.includes("weekly-scoped") ||
    named(limit, "fable")
  );
}

export function busiestLimit(limits: readonly VibeCodingLimit[], now: number): VibeCodingLimit | null {
  const candidates = limits.filter((limit) => !isExtraLimitWindow(limit));
  if (candidates.length === 0) return null;
  const effective = (limit: VibeCodingLimit) =>
    now && limit.resetsAt != null && limit.resetsAt * 1000 <= now ? 0 : limit.usedPercent;
  return candidates.reduce((best, row) => (effective(row) > effective(best) ? row : best));
}

export function limitWindowTitle(limit: Pick<VibeCodingLimit, "label" | "windowMinutes">): string | null {
  const label = limit.label?.trim();
  if (label) return label;
  const minutes = limit.windowMinutes;
  if (minutes == null || minutes <= 0) return null;
  if (minutes === FIVE_HOUR_MINUTES) return "5-hour";
  if (minutes === WEEK_MINUTES) return "Weekly";
  if (minutes % DAY_MINUTES !== 0) return null;
  const days = minutes / DAY_MINUTES;
  if (days >= 28 && days <= 31) return "Monthly";
  if (days === 1) return "Daily";
  return `${days}-day`;
}
