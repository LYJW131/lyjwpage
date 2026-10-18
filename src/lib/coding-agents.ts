
import { codingAgentLabel } from "@shared/coding-agent-labels";
import { CODING_USAGE_SOURCES } from "@shared/coding-usage-sources";

import type {
  CodingNowPayload,
  CodingUsageAgentView,
  CodingUsagePayload,
  CodingUsageSource,
} from "@shared/types.ts";
import { agentLimitsOf, type AgentLimitFields, type AgentLimitsPayload } from "@shared/vibecoding-limits.ts";

export type CodingAgentRowKind = "featured" | "compact" | "hidden";

export type CodingAgentBrand = {
  label: string;
  icon: string;
  row: CodingAgentRowKind;
};

// 显示名统一在 shared/coding-agent-labels.ts#CODING_AGENT_LABELS，这里只登记站点专属的图标与行型。
export const CODING_AGENTS = {
  claude: { icon: "anthropic", row: "featured" },
  cursor: { icon: "cursor", row: "featured" },
  codex: { icon: "openai", row: "compact" },
  grok: { icon: "grok", row: "compact" },
  antigravity: { icon: "antigravity", row: "compact" },
  opencode: { icon: "opencode", row: "hidden" },
  pi: { icon: "pi", row: "hidden" },
  devin: { icon: "devin", row: "compact" },
} as const satisfies Record<string, Omit<CodingAgentBrand, "label">>;

const REGISTERED = Object.keys(CODING_AGENTS);

export function codingAgentBrand(id: string): CodingAgentBrand {
  const registered = Object.hasOwn(CODING_AGENTS, id) ? CODING_AGENTS[id as keyof typeof CODING_AGENTS] : null;
  return { label: codingAgentLabel(id), icon: registered?.icon ?? id, row: registered?.row ?? "compact" };
}

export const CODING_SOURCE_LABELS: Record<CodingUsageSource, string> = {
  mac: "Mac",
  agents: "Account",
  "agents-otlp": "Cloud",
};

export type CodingActivityEntry = CodingNowPayload["agents"][number]["activity"][number];

export type CodingAgentRow = CodingAgentBrand &
  AgentLimitFields & {
    id: string;
    usage: CodingUsageAgentView | null;
    activity: CodingActivityEntry[];
  };

export function codingAgentRows(
  usage: Pick<CodingUsagePayload, "agents"> | null,
  now: Pick<CodingNowPayload, "agents"> | null,
  limits: AgentLimitsPayload | null,
): CodingAgentRow[] {
  const usageById = new Map((usage?.agents ?? []).map((agent) => [agent.id, agent]));
  const activityById = new Map((now?.agents ?? []).map((agent) => [agent.id, agent.activity]));
  const ids = new Set([...usageById.keys(), ...activityById.keys(), ...Object.keys(limits?.agents ?? {})]);
  const rank = (id: string) => {
    const index = REGISTERED.indexOf(id);
    return index === -1 ? REGISTERED.length : index;
  };
  return [...ids]
    .sort((left, right) => rank(left) - rank(right) || left.localeCompare(right))
    .map((id) => ({
      id,
      ...codingAgentBrand(id),
      ...agentLimitsOf(limits, id),
      usage: usageById.get(id) ?? null,
      activity: [...(activityById.get(id) ?? [])].sort((left, right) => right.lastActivityAt - left.lastActivityAt),
    }));
}

export type CodingActivitySlots = { mac: CodingActivityEntry | null; remote: CodingActivityEntry | null };

export function codingActivitySlots(activity: readonly CodingActivityEntry[], macDeclaredOffline: boolean): CodingActivitySlots {
  return {
    mac: macDeclaredOffline ? null : (activity.find((entry) => entry.source === "mac") ?? null),
    remote: activity.find((entry) => entry.source !== "mac") ?? null,
  };
}

export const CODING_ACTIVE_WINDOW_MS = 5 * 60_000;

export function codingDisplayModel(row: Pick<CodingAgentRow, "activity" | "usage">, live: CodingActivityEntry | null, active: boolean): string | null {
  return (active ? live?.model : null) ?? row.activity.find((entry) => entry.model)?.model ?? row.usage?.latestModel ?? null;
}

export type CodingSourceNote = { source: CodingUsageSource; label: string; state: CodingUsageAgentView["status"][number]["state"]; error: string | null; warning: string | null };

export function codingSourceHealth(usage: CodingUsageAgentView | null): { failing: CodingSourceNote[]; notes: CodingSourceNote[] } {
  const notes = (usage?.status ?? []).map((status) => ({
    source: status.source,
    label: CODING_SOURCE_LABELS[status.source] ?? status.source,
    state: status.state,
    error: status.error,
    warning: status.warning,
  }));
  return { failing: notes.filter((note) => note.state === "error"), notes };
}

export function describeCodingSources(notes: readonly CodingSourceNote[]): string {
  const account = notes.find((note) => note.state !== "conflict" && CODING_USAGE_SOURCES[note.source]?.scope === "account");
  return notes
    .map((note) => {
      switch (note.state) {
        case "ok":
          return `${note.label}: counted${note.warning ? ` (${note.warning})` : ""}`;
        case "error":
          return `${note.label}: failed to update${note.error ? ` — ${note.error}` : ""}`;
        case "superseded":
          return `${note.label}: covered by ${account?.label ?? "account history"}`;
        case "conflict":
          return `${note.label}: ignored (duplicate account source)`;
      }
    })
    .join("\n");
}
