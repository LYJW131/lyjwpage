
import { object, text } from "./json.ts";
import type { VibeCodingLimit, VibeCodingPlan } from "./types.ts";

export type ParsedAgentLimitsRow = {
  id: string;
  plan: VibeCodingPlan | null;
  limits: VibeCodingLimit[];
  limitsError: string | null;
};

export type ParsedAgentLimits = {
  agents: ParsedAgentLimitsRow[];
  collectedAt: string;
};

function positiveOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function normalizePlan(value: unknown): VibeCodingPlan | null {
  const row = object(value);
  if (!row) return null;
  const tier = text(row.tier);
  if (!tier) return null;
  return { tier, label: text(row.label) ?? tier };
}

function normalizeLimits(value: unknown): VibeCodingLimit[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): VibeCodingLimit[] => {
    const row = object(entry);
    if (!row) return [];
    const key = text(row.key);
    if (!key) return [];
    if (typeof row.usedPercent !== "number" || !Number.isFinite(row.usedPercent)) return [];
    return [{
      key,
      label: text(row.label),
      group: text(row.group),
      windowMinutes: positiveOrNull(row.windowMinutes),
      usedPercent: Math.min(100, Math.max(0, row.usedPercent)),
      resetsAt: positiveOrNull(row.resetsAt),
    }];
  });
}

export function normalizeAgentLimits(input: unknown): ParsedAgentLimits | null {
  const root = object(input);
  if (!root || !Array.isArray(root.agents)) return null;

  const seen = new Set<string>();
  const agents: ParsedAgentLimitsRow[] = [];
  for (const value of root.agents) {
    const row = object(value);
    const id = row ? text(row.id) : null;
    if (!row || !id || seen.has(id)) return null;
    seen.add(id);
    agents.push({
      id,
      plan: normalizePlan(row.plan),
      limits: normalizeLimits(row.limits),
      limitsError: text(row.limitsError),
    });
  }
  if (agents.length === 0) return null;

  return {
    agents,
    collectedAt:
      typeof root.collectedAt === "string" && Number.isFinite(Date.parse(root.collectedAt))
        ? root.collectedAt
        : new Date().toISOString(),
  };
}
