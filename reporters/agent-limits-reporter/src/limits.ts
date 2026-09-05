import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

import { fetchAntigravityViaCli } from "./cli-usage.js";
import { config } from "./config.js";
import type { AgentLimit, AgentRow } from "./site.js";

/**
 * TokenTracker 的 CJS 入口。包名在 npm 里可能是 tokentracker 或上游的 tokentracker-cli。
 */
type UsageLimitsModule = {
  getUsageLimits: (options: {
    home?: string;
    env?: NodeJS.ProcessEnv;
    platform?: string;
  }) => Promise<Record<string, unknown>>;
  resetUsageLimitsCache: () => void;
};

const require = createRequire(import.meta.url);

function loadUsageLimits(): UsageLimitsModule {
  const specs = [
    "tokentracker/src/lib/usage-limits.js",
    "tokentracker-cli/src/lib/usage-limits.js",
  ];
  let last: unknown;
  for (const spec of specs) {
    try {
      return require(spec) as UsageLimitsModule;
    } catch (error) {
      last = error;
    }
  }
  throw new Error(
    `找不到 tokentracker 的 usage-limits.js：${last instanceof Error ? last.message : String(last)}`,
  );
}

const tracker = loadUsageLimits();

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/** TokenTrackerAPI.number：数字或可解析的字符串，其余当 0 */
function number(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") return Number(value) || 0;
  return 0;
}

/**
 * TokenTrackerAPI.unixSeconds：Codex 给 epoch 秒，其余几家给 ISO8601。
 * 毫秒时间戳（> 1e12）先收成秒。
 */
function unixSeconds(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value > 1e12 ? Math.trunc(value / 1000) : Math.trunc(value);
  }
  const textValue = text(value);
  if (!textValue) return null;
  const ms = Date.parse(textValue);
  if (!Number.isFinite(ms)) return null;
  return Math.trunc(ms / 1000);
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

function planTier(provider: string, node: Record<string, unknown>): string | null {
  if (provider === "codex") {
    return text(node.plan_type) ?? text(node.plan_label);
  }
  return text(node.plan_label);
}

function window(
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

function claudeWindows(node: Record<string, unknown>): AgentLimit[] {
  const windows: AgentLimit[] = [];
  const five = object(node.five_hour);
  if (five) windows.push(window("claude.primary", null, 300, five));
  const weekly = object(node.seven_day);
  if (weekly) windows.push(window("weekly_all", null, 10_080, weekly));
  const weeklyReset = weekly ? unixSeconds(resetValue(weekly)) : null;
  const opus = object(node.seven_day_opus);
  if (opus) {
    windows.push(window("claude-weekly-scoped-opus", "Opus only", 10_080, opus, weeklyReset));
  }
  const scoped = Array.isArray(node.weekly_scoped) ? node.weekly_scoped : [];
  for (const row of scoped) {
    const item = object(row);
    if (!item) continue;
    const name = text(item.label);
    if (!name) continue;
    windows.push(
      window(`claude-weekly-scoped-${name.toLowerCase()}`, `${name} only`, 10_080, item, weeklyReset),
    );
  }
  return windows;
}

function codexWindows(node: Record<string, unknown>): AgentLimit[] {
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
    windows.push(window(slot.key, slot.label, minutes(value), value));
  }
  return windows;
}

function genericWindows(provider: string, node: Record<string, unknown>): AgentLimit[] {
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
    windows.push(
      window(`${provider}.${slot.suffix}`, text(value.label), minutes(value), value),
    );
  }
  return windows;
}

function claudeNeedsReauth(node: Record<string, unknown>): boolean {
  if (text(node.auth_action_required) === "reauth") return true;
  const error = text(node.error)?.toLowerCase() ?? "";
  return error.includes("token expired") || error.includes("auth_expired");
}

export function translateProvider(id: string, node: Record<string, unknown>): AgentRow | null {
  const failure = text(node.error);
  if (failure) {
    const message = `TokenTracker ${id}：${failure}`;
    return { id, plan: null, limits: [], limitsError: message };
  }
  if (node.configured !== true) return null;

  const limits =
    id === "claude" ? claudeWindows(node) : id === "codex" ? codexWindows(node) : genericWindows(id, node);
  const tier = planTier(id, node);
  const plan = tier ? { tier, label: agentPlanLabel(id, tier) } : null;
  if (limits.length === 0) {
    return {
      id,
      plan,
      limits: [],
      limitsError: `TokenTracker ${id} 响应里没有限额窗口`,
    };
  }
  return { id, plan, limits, limitsError: null };
}

export function translateUsageLimits(
  root: Record<string, unknown>,
  ids: readonly string[] = config.agentIds,
): AgentRow[] {
  const agents: AgentRow[] = [];
  for (const id of ids) {
    const node = object(root[id]);
    if (!node) continue;
    const row = translateProvider(id, node);
    if (row) agents.push(row);
  }
  return agents;
}

function asRecord(value: unknown): Record<string, unknown> {
  const rec = object(value);
  if (!rec) throw new Error("usage-limits 输出不是对象");
  return rec;
}

async function loadFixture(file: string): Promise<Record<string, unknown>> {
  const raw = await readFile(file, "utf8");
  return asRecord(JSON.parse(raw));
}

export async function fetchUsageLimits(): Promise<Record<string, unknown>> {
  if (config.limitsFixture) return loadFixture(config.limitsFixture);
  return asRecord(
    await tracker.getUsageLimits({
      home: config.home,
      env: process.env,
      platform: "linux",
    }),
  );
}

export function resetUsageLimitsCache(): void {
  tracker.resetUsageLimitsCache();
}

export function usageSaysClaudeReauth(root: Record<string, unknown>): boolean {
  const node = object(root.claude);
  return node ? claudeNeedsReauth(node) : false;
}

/**
 * cursor：TokenTracker 的 JWT 来自 Cursor.app 的 sqlite，不是 `~/.cursor/cli-config.json`
 * （那里只有 authId / email，实测 2026-09-05）；cursor-agent 的 print 模式也不拦截 `/usage`
 * （会当成普通提示词交给模型）。容器里确认不了可用凭据，这一行不发。
 *
 * antigravity：TokenTracker 问 IDE 进程，容器里改问 `agy -p /usage`（见 cli-usage.ts）。
 * fixture 模式下不跑 CLI，antigravity 从 fixture 里来。
 */
export async function translateAndOverlay(root: Record<string, unknown>): Promise<AgentRow[]> {
  if (config.agentIds.includes("cursor")) {
    delete root.cursor;
  }
  const wantAntigravity = config.agentIds.includes("antigravity");
  if (wantAntigravity && !config.limitsFixture) {
    delete root.antigravity;
  }
  const rows = translateUsageLimits(root, config.agentIds);
  if (wantAntigravity && !config.limitsFixture) {
    const viaCli = await fetchAntigravityViaCli();
    if (viaCli) rows.push(viaCli);
  }
  return rows;
}

export async function collectAgents(): Promise<AgentRow[]> {
  return translateAndOverlay(await fetchUsageLimits());
}
