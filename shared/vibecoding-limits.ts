
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
// /api/ingest/agents/cards 写，限额读数认出用了卡时由 ingress 减一（detectResetCardUse）；跟限额分开存，免得上报器整行替换 claude 时冲掉。
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

// Fable 条满格折合周额度的百分比（条的死区与 Fable 卡退回的周额度都按它算）。
export const FABLE_WEEKLY_SHARE_PERCENT = 50;

// 用卡判据：重置时间离到点还早，读数却从至少 MIN_USED 掉到不超过 CLEARED。
// Fable 卡还要求周额度正好退回 Fable 用量 × 50%（差 REFUND_SLACK 以内），全是 Fable 用量时周额度也会归零，靠这条跟周卡分开。
const RESET_CARD_MIN_USED_PERCENT = 5;
const RESET_CARD_CLEARED_PERCENT = 1;
const RESET_CARD_REFUND_SLACK_PERCENT = 3;
const NATURAL_RESET_SLACK_MS = 3_600_000;

export function detectResetCardUse(
  previous: AgentLimitsRow | undefined,
  next: AgentLimitsRow | undefined,
  at: number,
): keyof ClaudeResetCards | null {
  const weekly = (row: AgentLimitsRow | undefined) => row?.limits.find((limit) => limit.key === "weekly_all");
  const fable = (row: AgentLimitsRow | undefined) => row?.limits.find((limit) => `${limit.key} ${limit.label ?? ""}`.toLowerCase().includes("fable"));
  const [weeklyBefore, weeklyAfter] = [weekly(previous), weekly(next)];
  if (!weeklyBefore || !weeklyAfter || weeklyBefore.resetsAt == null) return null;
  if (weeklyBefore.resetsAt * 1000 <= at + NATURAL_RESET_SLACK_MS) return null;
  const [fableBefore, fableAfter] = [fable(previous), fable(next)];
  const cleared = (before: number, after: number) => before >= RESET_CARD_MIN_USED_PERCENT && after <= RESET_CARD_CLEARED_PERCENT;
  if (fableBefore && fableAfter && cleared(fableBefore.usedPercent, fableAfter.usedPercent)) {
    const refund = weeklyBefore.usedPercent - weeklyAfter.usedPercent;
    if (Math.abs(refund - (fableBefore.usedPercent * FABLE_WEEKLY_SHARE_PERCENT) / 100) <= RESET_CARD_REFUND_SLACK_PERCENT) return "fable";
  }
  return cleared(weeklyBefore.usedPercent, weeklyAfter.usedPercent) ? "standard" : null;
}

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
