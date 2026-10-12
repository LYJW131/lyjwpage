
import type { VibeCodingLimit, VibeCodingPlan } from "./types.ts";
import type { ParsedAgentLimits } from "./agent-limits-parse.ts";

export type AgentLimitsRow = {
  plan: VibeCodingPlan | null;
  limits: VibeCodingLimit[];
  limitsError: string | null;
  updatedAt: number;
};

export type AgentLimitsPayload = {
  agents: Record<string, AgentLimitsRow>;
};

// 采集失败的行必须整行替换；字段合并会把旧限额伪装成当前结果。
export function mergeAgentLimits(
  previous: AgentLimitsPayload | null,
  incoming: ParsedAgentLimits,
  receivedAt: number,
): AgentLimitsPayload {
  const agents: Record<string, AgentLimitsRow> = { ...(previous?.agents ?? {}) };
  for (const row of incoming.agents) {
    agents[row.id] = {
      plan: row.plan,
      limits: row.limits,
      limitsError: row.limitsError,
      updatedAt: receivedAt,
    };
  }
  return { agents };
}

export function agentLimitsLayoutKey(payload: AgentLimitsPayload | null): string {
  return JSON.stringify(Object.keys(payload?.agents ?? {}).sort());
}

export type AgentLimitFields = {
  plan: VibeCodingPlan | null;
  limits: VibeCodingLimit[];
  limitsError: string | null;
  limitsAt: number | null;
};

const NO_LIMITS: AgentLimitFields = {
  plan: null,
  limits: [],
  limitsError: null,
  limitsAt: null,
};

export function agentLimitsOf(stored: AgentLimitsPayload | null, id: string): AgentLimitFields {
  const row = stored && Object.hasOwn(stored.agents, id) ? stored.agents[id] : undefined;
  if (!row) return NO_LIMITS;
  return {
    plan: row.plan,
    limits: row.limits,
    limitsError: row.limitsError,
    limitsAt: row.updatedAt,
  };
}
