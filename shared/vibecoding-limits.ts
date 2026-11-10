
import { object } from "./json.ts";
import type { VibeCodingLimit, VibeCodingPlan } from "./types.ts";
import type { ParsedAgentLimits } from "./agent-limits-parse.ts";

export type AgentLimitsRow = {
  plan: VibeCodingPlan | null;
  limits: VibeCodingLimit[];
  limitsError: string | null;
  // 源：shared/agent-limits-parse.ts#ParsedAgentLimitsRow
  authRefreshExpiresAt?: number;
  updatedAt: number;
};

// Claude 账户里手上的重置卡张数。上报器读不到（服务端按调用客户端放行），由 lyjw 在讨论串里说、云端线程经
// /api/ingest/agents/cards 写；跟限额分开存，免得上报器整行替换 claude 时冲掉。
// fable：清零 Fable 窗口并把本周 Fable 用量从周额度里退回；standard：周额度连同 Fable 窗口一起清零。两种都不动重置时间。
export type ClaudeResetCards = {
  fable: number;
  standard: number;
};

export type AgentLimitsPayload = {
  agents: Record<string, AgentLimitsRow>;
  claudeResetCards?: ClaudeResetCards & { updatedAt: number };
};

const MAX_RESET_CARDS = 99;

export function parseClaudeResetCards(input: unknown): ClaudeResetCards {
  const root = object(input);
  if (!root) throw new Error("重置卡上报必须是对象");
  const count = (field: "fable" | "standard") => {
    const value = root[field];
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_RESET_CARDS) {
      throw new Error(`${field} 必须是 0–${MAX_RESET_CARDS} 的整数`);
    }
    return value;
  };
  return { fable: count("fable"), standard: count("standard") };
}

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
      ...(row.authRefreshExpiresAt != null && { authRefreshExpiresAt: row.authRefreshExpiresAt }),
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
  authRefreshExpiresAt: number | null;
  limitsAt: number | null;
};

const NO_LIMITS: AgentLimitFields = {
  plan: null,
  limits: [],
  limitsError: null,
  authRefreshExpiresAt: null,
  limitsAt: null,
};

export function agentLimitsOf(stored: AgentLimitsPayload | null, id: string): AgentLimitFields {
  const row = stored && Object.hasOwn(stored.agents, id) ? stored.agents[id] : undefined;
  if (!row) return NO_LIMITS;
  return {
    plan: row.plan,
    limits: row.limits,
    limitsError: row.limitsError,
    authRefreshExpiresAt: row.authRefreshExpiresAt ?? null,
    limitsAt: row.updatedAt,
  };
}
