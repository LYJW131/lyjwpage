import type { CodingAgentRow } from "@/lib/coding-agents";
import type { VibeCodingLimit } from "@shared/types";

const LIMIT_WARN_PERCENT = 75;
const LIMIT_ALERT_PERCENT = 90;
const LIMIT_BAR_COLOR = "oklch(0.63 0.18 250)";
const LIMIT_WARN_COLOR = "oklch(0.72 0.16 75)";
const LIMIT_ALERT_COLOR = "oklch(0.62 0.21 25)";
export const LIMIT_OVER_PACE_COLOR = LIMIT_ALERT_COLOR;
export const LIMIT_ON_PACE_COLOR = "oklch(0.65 0.17 145)";

export function limitColor(usedPercent: number) {
  if (usedPercent >= LIMIT_ALERT_PERCENT) return LIMIT_ALERT_COLOR;
  if (usedPercent >= LIMIT_WARN_PERCENT) return LIMIT_WARN_COLOR;
  return LIMIT_BAR_COLOR;
}

function busiestLimit(limits: VibeCodingLimit[], now: number) {
  const candidates = limits.filter((limit) => !isExtraWindow(limit));
  if (candidates.length === 0) return null;
  const effective = (limit: VibeCodingLimit) =>
    now && limit.resetsAt != null && limit.resetsAt * 1000 <= now ? 0 : limit.usedPercent;
  return candidates.reduce((best, row) => (effective(row) > effective(best) ? row : best));
}

const SESSION_WINDOW_MAX_MINUTES = 1440;

// Cursor 按键匹配；按时长推断会把 tertiary 误当专项窗口而剔除。
const FEATURED_LIMITS: Record<
  string,
  ReadonlyArray<{ slot: FeaturedLimitSlot; title: string }>
> = {
  claude: [
    { slot: "session", title: "5-hour" },
    { slot: "weekly", title: "Weekly" },
    { slot: "fable", title: "Fable" },
  ],
  cursor: [
    { slot: "cursor.secondary", title: "Cursor models" },
    { slot: "cursor.tertiary", title: "Other models" },
    { slot: "cursor.quaternary", title: "Grok Bot" },
  ],
};

type FeaturedLimitSlot =
  | "session"
  | "weekly"
  | "fable"
  | "cursor.secondary"
  | "cursor.tertiary"
  | "cursor.quaternary";

function isNamedLimit(limit: VibeCodingLimit, name: string) {
  return `${limit.key} ${limit.label ?? ""}`.toLowerCase().includes(name);
}

function isSparkWindow(limit: VibeCodingLimit) {
  return (
    limit.key.endsWith(".tertiary") ||
    isNamedLimit(limit, "spark") ||
    isNamedLimit(limit, "bengalfox")
  );
}

function isExtraWindow(limit: VibeCodingLimit) {
  return isSparkWindow(limit) || limit.key.includes("weekly-scoped") || isNamedLimit(limit, "fable");
}

function isSessionWindow(limit: VibeCodingLimit) {
  return (
    limit.group === "session" ||
    (limit.windowMinutes != null && limit.windowMinutes < SESSION_WINDOW_MAX_MINUTES)
  );
}

function limitSlot(limit: VibeCodingLimit): "session" | "weekly" | null {
  if (isExtraWindow(limit)) return null;
  return isSessionWindow(limit) ? "session" : "weekly";
}

function pickSlotLimit(limits: VibeCodingLimit[], slot: FeaturedLimitSlot) {
  if (slot === "fable") {
    return limits.find((limit) => isNamedLimit(limit, "fable")) ?? null;
  }
  if (slot !== "session" && slot !== "weekly") {
    return limits.find((limit) => limit.key === slot) ?? null;
  }
  const matched = limits.filter((limit) => limitSlot(limit) === slot);
  if (matched.length === 0) return null;
  if (slot === "weekly") {
    return matched.find((limit) => limit.key === "weekly_all") ?? matched[0] ?? null;
  }
  return matched.find((limit) => limit.key.endsWith(".primary")) ?? matched[0] ?? null;
}

export function compactLimit(row: Pick<CodingAgentRow, "limits">, now: number) {
  return busiestLimit(row.limits, now);
}

type FeaturedLimitRow =
  | { kind: "limit"; key: string; title: string; limit: VibeCodingLimit }
  | { kind: "unavailable"; key: string; title: string; reason: string };

export function featuredLimitRows(row: Pick<CodingAgentRow, "id" | "limits" | "limitsError">): FeaturedLimitRow[] {
  const slots = Object.hasOwn(FEATURED_LIMITS, row.id) ? FEATURED_LIMITS[row.id]! : [];
  return slots.map(({ slot, title }) => {
    const limit = pickSlotLimit(row.limits, slot);
    if (limit) return { kind: "limit" as const, key: slot, title, limit };
    return {
      kind: "unavailable" as const, key: slot, title,
      reason: row.limitsError ?? "No limit reported for this window",
    };
  });
}

export function hasFeaturedLimits(id: string) {
  return Object.hasOwn(FEATURED_LIMITS, id);
}

export function weeklyLimit(row: Pick<CodingAgentRow, "limits">) {
  return pickSlotLimit(row.limits, "weekly");
}

const WEEK_MS = 7 * 86_400_000;
// setTimeout 超过 2^31-1 会立即触发，且调用处还要加等待余量。
const MAX_TIMEOUT_MS = 24 * 86_400_000;

type ResetDisplay =
  | { kind: "relative"; hours: number; minutes: number }
  | { kind: "absolute"; text: string };

// timeZone 缺省按看的人本地时区；出图时没有看的人，按站点时区。
export function formatReset(resetsAt: number | null, referenceTime: number, timeZone?: string): ResetDisplay | null {
  if (resetsAt == null) return null;
  const remain = resetsAt * 1000 - referenceTime;
  if (remain <= 0) return null;
  if (remain >= 86_400_000) {
    const at = new Date(Math.round(resetsAt / 60) * 60_000);
    if (remain >= WEEK_MS) {
      return {
        kind: "absolute",
        text: `Resets ${at.toLocaleString("en-US", { month: "short", day: "numeric", timeZone })}`,
      };
    }
    const weekday = at.toLocaleString("en-US", { weekday: "short", timeZone });
    const clock = at.toLocaleString("en-US", { hour: "numeric", minute: "2-digit", timeZone });
    return { kind: "absolute", text: `Resets ${weekday} ${clock}` };
  }
  const totalMinutes = Math.floor(remain / 60_000);
  return {
    kind: "relative",
    hours: Math.floor(totalMinutes / 60),
    minutes: totalMinutes % 60,
  };
}

export function nextTickDelay(remain: number) {
  if (remain > WEEK_MS) return Math.min(remain - WEEK_MS, MAX_TIMEOUT_MS);
  if (remain > 86_400_000) return remain - 86_400_000;
  if (remain <= 60_000) return Math.max(0, remain);
  return remain % 60_000 || 60_000;
}

type CompactResetDisplay =
  | { kind: "relative"; hours: number; minutes: number }
  | { kind: "days"; days: number; hours: number };

export function formatCompactReset(
  resetsAt: number | null,
  referenceTime: number,
): CompactResetDisplay | null {
  if (resetsAt == null) return null;
  const remain = resetsAt * 1000 - referenceTime;
  if (remain <= 0) return null;
  if (remain >= 86_400_000) {
    return {
      kind: "days",
      days: Math.floor(remain / 86_400_000),
      hours: Math.floor((remain % 86_400_000) / 3_600_000),
    };
  }
  const totalMinutes = Math.floor(remain / 60_000);
  return {
    kind: "relative",
    hours: Math.floor(totalMinutes / 60),
    minutes: totalMinutes % 60,
  };
}

// 倒计时可能几天不醒，配速指示器必须独立排期。
export function paceTickInterval(windowMs: number) {
  return Math.min(Math.max(windowMs / 500, 60_000), 10 * 60_000);
}

// 分组名不是窗口时长，不能从 weekly 推断起点。
export function limitPace(limit: VibeCodingLimit, now: number): number | null {
  if (!now || limit.windowMinutes == null || limit.resetsAt == null) return null;
  const windowMs = limit.windowMinutes * 60_000;
  if (windowMs <= 0) return null;
  const remain = limit.resetsAt * 1000 - now;
  if (remain <= 0) return 0;
  return Math.min(1, Math.max(0, 1 - remain / windowMs));
}

export function nextCompactTickDelay(remain: number) {
  if (remain > 86_400_000) return remain % 3_600_000 || 3_600_000;
  if (remain <= 60_000) return Math.max(0, remain);
  return remain % 60_000 || 60_000;
}

export const LIMITS_SILENT = "Limits reporter is silent";
