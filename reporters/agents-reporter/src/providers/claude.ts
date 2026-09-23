import { config } from "../config.js";
import { readClaudeOauth } from "../claude-oauth.js";
import type { AgentRow } from "../site.js";
import { agentPlanLabel, claudeWindows, object, rowFromWindows, text } from "../windows.js";

export const CLAUDE_AUTH_EXPIRED_MESSAGE =
  "Claude token expired — run `claude` once to refresh.";

export class ClaudeAuthExpiredError extends Error {
  code = "AUTH_EXPIRED" as const;
  constructor(message = CLAUDE_AUTH_EXPIRED_MESSAGE) {
    super(message);
    this.name = "ClaudeAuthExpiredError";
  }
}

export function isClaudeAuthExpired(error: unknown): boolean {
  return (
    (error instanceof ClaudeAuthExpiredError ||
      (error instanceof Error && (error as { code?: string }).code === "AUTH_EXPIRED"))
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return object(value);
}

function claudeNormalizedWords(raw: unknown): string[] {
  if (typeof raw !== "string") return [];
  return raw.trim().toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function claudePlanKindFromText(raw: unknown, { includeUltra = false } = {}): string | null {
  const words = claudeNormalizedWords(raw);
  if (words.includes("max")) return "max";
  if (words.includes("pro")) return "pro";
  if (words.includes("team")) return "team";
  if (words.includes("enterprise")) return "enterprise";
  if (includeUltra && words.includes("ultra")) return "ultra";
  return null;
}

function claudeMaxUsageMultiplier(rateLimitTier: unknown): string | null {
  const words = claudeNormalizedWords(rateLimitTier);
  const maxIndex = words.indexOf("max");
  if (maxIndex < 0 || maxIndex + 1 >= words.length) return null;
  const multiplier = words[maxIndex + 1];
  return multiplier && /^[1-9]\d*x$/.test(multiplier) ? multiplier : null;
}

export function formatClaudePlanLabel(
  subscriptionType: string | null,
  rateLimitTier: string | null,
): string | null {
  const kind =
    claudePlanKindFromText(subscriptionType, { includeUltra: true }) ||
    claudePlanKindFromText(rateLimitTier);
  if (!kind) return subscriptionType;
  if (kind === "max") {
    const multiplier = claudeMaxUsageMultiplier(rateLimitTier);
    return multiplier ? `Max ${multiplier}` : "Max";
  }
  const labels: Record<string, string> = {
    pro: "Pro",
    team: "Team",
    enterprise: "Enterprise",
    ultra: "Ultra",
  };
  return labels[kind] ?? null;
}

export function extractClaudeProfilePlan(
  body: unknown,
): { subscriptionType: string | null; rateLimitTier: string | null } | null {
  const rec = asRecord(body);
  if (!rec) return null;
  const org = asRecord(rec.organization);
  const account = asRecord(rec.account);
  const rateLimitTier = text(org?.rate_limit_tier);
  const orgType = text(org?.organization_type)?.toLowerCase() ?? "";
  let subscriptionType: string | null = null;
  if (orgType.includes("max") || account?.has_claude_max === true) subscriptionType = "max";
  else if (orgType.includes("enterprise")) subscriptionType = "enterprise";
  else if (orgType.includes("team")) subscriptionType = "team";
  else if (orgType.includes("ultra")) subscriptionType = "ultra";
  else if (orgType.includes("pro") || account?.has_claude_pro === true) subscriptionType = "pro";
  if (!subscriptionType && !rateLimitTier) return null;
  return { subscriptionType, rateLimitTier };
}

function claudeResetsAtFromLimitsEntry(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function claudeWindowFromLimitsEntry(entry: unknown): Record<string, unknown> | null {
  const rec = asRecord(entry);
  if (!rec) return null;
  const utilization = Number(rec.percent ?? rec.utilization ?? rec.used_percentage);
  if (!Number.isFinite(utilization)) return null;
  return { utilization, resets_at: claudeResetsAtFromLimitsEntry(rec.resets_at) };
}

function claudeWindowUtilization(window: unknown): number | null {
  const rec = asRecord(window);
  if (!rec) return null;
  const util = Number(rec.utilization ?? rec.percent ?? rec.used_percentage);
  return Number.isFinite(util) ? util : null;
}

function claudeWindowIsIdleShell(window: unknown): boolean {
  const rec = asRecord(window);
  const util = claudeWindowUtilization(window);
  if (util === null || util > 0) return false;
  if (!rec) return true;
  const reset = rec.resets_at ?? rec.reset_at;
  const hasReset =
    (typeof reset === "string" && reset.trim().length > 0) ||
    (Number.isFinite(Number(reset)) && Number(reset) > 0);
  const hasDollars = Number(rec.used_dollars) > 0 || Number(rec.limit_dollars) > 0;
  return !hasReset && !hasDollars;
}

function extractClaudeLimitsWindow(body: Record<string, unknown>, kinds: string[]): Record<string, unknown> | null {
  if (!Array.isArray(body.limits)) return null;
  const want = new Set(kinds);
  for (const entry of body.limits) {
    const rec = asRecord(entry);
    if (!rec || !want.has(rec.kind as string)) continue;
    const window = claudeWindowFromLimitsEntry(rec);
    if (!window || claudeWindowIsIdleShell(window)) continue;
    return window;
  }
  return null;
}

function coalesceClaudeWindow(
  legacy: unknown,
  body: Record<string, unknown>,
  kinds: string[],
): unknown {
  const fromLimits = extractClaudeLimitsWindow(body, kinds);
  if (claudeWindowUtilization(legacy) !== null) {
    if (fromLimits && claudeWindowIsIdleShell(legacy)) return fromLimits;
    return legacy;
  }
  return fromLimits || legacy || null;
}

function ensureClaudeFiveHourWindow(window: unknown, body: Record<string, unknown>): unknown {
  if (claudeWindowUtilization(window) !== null) return window;
  const fromLimits = extractClaudeLimitsWindow(body, ["session", "five_hour"]);
  if (fromLimits) return fromLimits;
  if (body.seven_day || coalesceClaudeWindow(body.seven_day, body, ["weekly_all", "seven_day"])) {
    return { utilization: 0, resets_at: null };
  }
  return window || null;
}

function extractClaudeScopedWeekly(body: Record<string, unknown>): unknown {
  if (!Array.isArray(body.limits)) return null;
  const out: Array<Record<string, unknown>> = [];
  for (const entry of body.limits) {
    const rec = asRecord(entry);
    if (!rec || rec.kind !== "weekly_scoped") continue;
    const scope = asRecord(rec.scope);
    const model = asRecord(scope?.model);
    const label = text(model?.display_name) ?? text(model?.id);
    if (!label) continue;
    if (body.seven_day_opus && label.toLowerCase() === "opus") continue;
    const utilization = Number(rec.percent);
    if (!Number.isFinite(utilization)) continue;
    out.push({
      label,
      utilization,
      resets_at: typeof rec.resets_at === "string" ? rec.resets_at : null,
    });
  }
  return out.length > 0 ? out : null;
}

/** 把 usage 接口的响应体规整成 claudeWindows 吃的形状。纯函数。 */
export function normalizeClaudeUsage(body: unknown): Record<string, unknown> {
  const rec = asRecord(body);
  if (!rec) throw new Error("Claude usage 响应不是对象");
  return {
    five_hour: ensureClaudeFiveHourWindow(
      coalesceClaudeWindow(rec.five_hour, rec, ["session", "five_hour"]),
      rec,
    ),
    seven_day: coalesceClaudeWindow(rec.seven_day, rec, ["weekly_all", "seven_day"]),
    seven_day_opus: rec.seven_day_opus ?? null,
    weekly_scoped: extractClaudeScopedWeekly(rec) ?? rec.weekly_scoped ?? null,
    extra_usage: rec.extra_usage ?? null,
  };
}

export function claudePlanFromHints(
  subscriptionType: string | null,
  rateLimitTier: string | null,
): { tier: string; label: string } | null {
  const formatted = formatClaudePlanLabel(subscriptionType, rateLimitTier);
  const tier = formatted || rateLimitTier || subscriptionType;
  if (!tier) return null;
  return { tier, label: agentPlanLabel("claude", tier) };
}

export function rowFromClaudeUsage(
  body: unknown,
  hints: { subscriptionType: string | null; rateLimitTier: string | null } | null = null,
): AgentRow {
  const node = normalizeClaudeUsage(body);
  if (hints) {
    const formatted = formatClaudePlanLabel(hints.subscriptionType, hints.rateLimitTier);
    if (formatted) node.plan_label = formatted;
    else if (hints.rateLimitTier) node.plan_label = hints.rateLimitTier;
    else if (hints.subscriptionType) node.plan_label = hints.subscriptionType;
  }
  const row = rowFromWindows("claude", node, claudeWindows(node));
  if (hints) {
    const plan = claudePlanFromHints(hints.subscriptionType, hints.rateLimitTier);
    if (plan) row.plan = plan;
  }
  return row;
}

function claudeHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    "anthropic-beta": "oauth-2025-04-20",
    Accept: "application/json",
  };
}

function formatClaudeRateLimitMessage(retryAfterSec: number | null): string {
  if (retryAfterSec != null && retryAfterSec > 0) {
    const mins = Math.ceil(retryAfterSec / 60);
    return `Claude API rate limited (429) — retry in ~${mins}m.`;
  }
  return "Claude API rate limited (429) — retry shortly.";
}

async function fetchClaudeOAuthProfile(
  accessToken: string,
): Promise<{ subscriptionType: string | null; rateLimitTier: string | null } | null> {
  try {
    const res = await fetch("https://api.anthropic.com/api/oauth/profile", {
      method: "GET",
      headers: claudeHeaders(accessToken),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    return extractClaudeProfilePlan(await res.json());
  } catch {
    return null;
  }
}

async function fetchClaudeUsageBody(accessToken: string): Promise<unknown> {
  const res = await fetch("https://api.anthropic.com/api/oauth/usage", {
    method: "GET",
    headers: claudeHeaders(accessToken),
    signal: AbortSignal.timeout(20_000),
  });
  if (res.status === 401) throw new ClaudeAuthExpiredError();
  if (res.status === 429) {
    const ra = res.headers.get("retry-after");
    const sec = ra ? Number.parseInt(ra, 10) : NaN;
    const retryAfterSec = Number.isFinite(sec) && sec > 0 ? sec : null;
    const error = new Error(formatClaudeRateLimitMessage(retryAfterSec));
    (error as { code?: string }).code = "RATE_LIMITED";
    throw error;
  }
  if (!res.ok) throw new Error(`Claude API returned ${res.status}`);
  return res.json();
}

export async function fetchClaude(): Promise<AgentRow | null> {
  const oauth = await readClaudeOauth();
  if (!oauth) return null;
  const accessToken = text(oauth.accessToken);
  if (!accessToken) throw new ClaudeAuthExpiredError();

  let hints: { subscriptionType: string | null; rateLimitTier: string | null } | null = {
    subscriptionType: text(oauth.subscriptionType),
    rateLimitTier: text(oauth.rateLimitTier),
  };
  if (!hints.subscriptionType && !hints.rateLimitTier) {
    hints = (await fetchClaudeOAuthProfile(accessToken)) ?? hints;
  }

  try {
    const body = await fetchClaudeUsageBody(accessToken);
    return rowFromClaudeUsage(body, hints);
  } catch (error) {
    if (isClaudeAuthExpired(error)) throw error;
    const message = error instanceof Error ? error.message : String(error);
    return { id: "claude", plan: null, limits: [], limitsError: message };
  }
}
