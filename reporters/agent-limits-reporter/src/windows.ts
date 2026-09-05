import type { AgentLimit } from "./site.js";

export function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function number(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") return Number(value) || 0;
  return 0;
}

export function unixSeconds(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value > 1e12 ? Math.trunc(value / 1000) : Math.trunc(value);
  }
  const textValue = text(value);
  if (!textValue) return null;
  const ms = Date.parse(textValue);
  if (!Number.isFinite(ms)) return null;
  return Math.trunc(ms / 1000);
}

function percent(node: Record<string, unknown>): number {
  return number(node.utilization ?? node.used_percent);
}

function resetValue(node: Record<string, unknown>): unknown {
  return node.resets_at ?? node.reset_at;
}

function minutes(node: Record<string, unknown>): number | null {
  const seconds = number(node.limit_window_seconds);
  return seconds > 0 ? Math.trunc(seconds / 60) : null;
}

/** 套餐展示名。key / 文案照抄 MacTelemetryHub agentPlanLabel，一个字都不改。 */
export function agentPlanLabel(agent: string, tier: string): string {
  switch (agent) {
    case "codex":
      switch (tier.toLowerCase()) {
        case "free":
          return "Free";
        case "go":
          return "Go";
        case "plus":
          return "Plus";
        case "pro":
          return "Pro";
        case "prolite":
          return "Pro Lite";
        case "team":
          return "Team";
        case "business":
          return "Business";
        case "enterprise":
          return "Enterprise";
        case "edu":
          return "Edu";
        default:
          return tier;
      }
    case "claude":
      if (tier.startsWith("Claude ")) return tier.slice("Claude ".length);
      switch (tier) {
        case "default_claude_max_5x":
          return "Max 5x";
        case "default_claude_max_20x":
          return "Max 20x";
        case "default_claude_pro":
          return "Pro";
        case "claude_max":
          return "Max";
        case "claude_pro":
          return "Pro";
        case "claude_free":
          return "Free";
        default:
          return tier;
      }
    default:
      return tier;
  }
}

export function planTier(provider: string, node: Record<string, unknown>): string | null {
  if (provider === "codex") {
    return text(node.plan_type) ?? text(node.plan_label);
  }
  return text(node.plan_label);
}

export function windowFrom(
  key: string,
  label: string | null,
  windowMinutes: number | null,
  node: Record<string, unknown>,
  fallbackReset: number | null = null,
): AgentLimit {
  return {
    key,
    label,
    group: null,
    windowMinutes,
    usedPercent: percent(node),
    resetsAt: unixSeconds(resetValue(node)) ?? fallbackReset,
  };
}

export function claudeWindows(node: Record<string, unknown>): AgentLimit[] {
  const windows: AgentLimit[] = [];
  const five = object(node.five_hour);
  if (five) windows.push(windowFrom("claude.primary", null, 300, five));
  const weekly = object(node.seven_day);
  if (weekly) windows.push(windowFrom("weekly_all", null, 10_080, weekly));
  const weeklyReset = weekly ? unixSeconds(resetValue(weekly)) : null;
  const opus = object(node.seven_day_opus);
  if (opus) {
    windows.push(windowFrom("claude-weekly-scoped-opus", "Opus only", 10_080, opus, weeklyReset));
  }
  const scoped = Array.isArray(node.weekly_scoped) ? node.weekly_scoped : [];
  for (const row of scoped) {
    const item = object(row);
    if (!item) continue;
    const name = text(item.label);
    if (!name) continue;
    windows.push(
      windowFrom(`claude-weekly-scoped-${name.toLowerCase()}`, `${name} only`, 10_080, item, weeklyReset),
    );
  }
  return windows;
}

export function codexWindows(node: Record<string, unknown>): AgentLimit[] {
  const slots: Array<{ key: string; label: string | null; field: string }> = [
    { key: "codex.primary", label: null, field: "primary_window" },
    { key: "codex.secondary", label: null, field: "secondary_window" },
    { key: "codex-spark-session", label: "Codex Spark 5h", field: "spark_primary_window" },
    { key: "codex-spark-weekly", label: "Codex Spark Weekly", field: "spark_secondary_window" },
  ];
  const windows: AgentLimit[] = [];
  for (const slot of slots) {
    const value = object(node[slot.field]);
    if (!value) continue;
    windows.push(windowFrom(slot.key, slot.label, minutes(value), value));
  }
  return windows;
}

export function genericWindows(provider: string, node: Record<string, unknown>): AgentLimit[] {
  const slots: Array<{ suffix: string; field: string }> = [
    { suffix: "primary", field: "primary_window" },
    { suffix: "secondary", field: "secondary_window" },
    { suffix: "tertiary", field: "tertiary_window" },
    { suffix: "quaternary", field: "quaternary_window" },
  ];
  const windows: AgentLimit[] = [];
  for (const slot of slots) {
    const value = object(node[slot.field]);
    if (!value) continue;
    windows.push(windowFrom(`${provider}.${slot.suffix}`, text(value.label), minutes(value), value));
  }
  return windows;
}

export function rowFromWindows(
  id: string,
  node: Record<string, unknown>,
  limits: AgentLimit[],
): import("./site.js").AgentRow {
  const tier = planTier(id, node);
  const plan = tier ? { tier, label: agentPlanLabel(id, tier) } : null;
  if (limits.length === 0) {
    return {
      id,
      plan,
      limits: [],
      limitsError: `${id} 响应里没有限额窗口`,
    };
  }
  return { id, plan, limits, limitsError: null };
}
