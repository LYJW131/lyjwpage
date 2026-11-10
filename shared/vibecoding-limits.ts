
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

// Claude 账户里手上的重置卡，按种类列每张的过期时间（Unix 秒）。上报器读不到（服务端按调用客户端放行），由 lyjw 在讨论串里说、云端线程经
// /api/ingest/agents/cards 写，限额读数认出用了卡时由 ingress 划掉一张（detectResetCardUse）；跟限额分开存，免得上报器整行替换 claude 时冲掉。
// fable：清零 Fable 窗口并把本周 Fable 用量从周额度里退回；standard：周额度连同 Fable 窗口一起清零。两种都不动重置时间。
export type ClaudeResetCardStock = {
  fable: number[];
  standard: number[];
};

// 对外只给此刻没过期的张数，过期时间不出可滞后层。
export type ClaudeResetCards = Record<keyof ClaudeResetCardStock, number>;

export type AgentLimitsPayload = {
  agents: Record<string, AgentLimitsRow>;
  claudeResetCards?: ClaudeResetCards & { updatedAt: number };
};

const MAX_RESET_CARDS = 99;

// Fable 条满格折合周额度的百分比（条的死区与 Fable 卡退回的周额度都按它算）。
export const FABLE_WEEKLY_SHARE_PERCENT = 50;

// 用卡判据，不假设两封上报之间用得多快：同一个周窗口里用量只涨不跌，读数是取整的百分比，掉了 ROUNDING 以上就只能是用了卡。
// 卡后到下一封之间新用掉多少都可能，只用它不能为负来排除：设 Fable 卡，周额度至少还剩「卡前 − Fable 掉的量 × 50%」，比这还低就只能是周卡。
// Fable 掉了而周额度对得上 Fable 卡时，周卡要求这段时间里恰好多用掉「卡前的非 Fable 用量」才凑得出同样的读数，按 Fable 卡算；
// 卡前几乎全是 Fable 用量时两种卡读数一样，两种都返回，由调用方按手上有的扣。卡后又用得比卡前还多、读数没往下掉的认不出。
const RESET_CARD_ROUNDING_PERCENT = 2;
const SAME_WINDOW_SLACK_SECONDS = 86_400;

export function detectResetCardUse(
  previous: AgentLimitsRow | undefined,
  next: AgentLimitsRow | undefined,
  at: number,
): (keyof ClaudeResetCards)[] {
  const weekly = (row: AgentLimitsRow | undefined) => row?.limits.find((limit) => limit.key === "weekly_all");
  const fable = (row: AgentLimitsRow | undefined) => row?.limits.find((limit) => `${limit.key} ${limit.label ?? ""}`.toLowerCase().includes("fable"));
  const [weeklyBefore, weeklyAfter] = [weekly(previous), weekly(next)];
  if (weeklyBefore?.resetsAt == null || weeklyAfter?.resetsAt == null) return [];
  const sameWindow = weeklyBefore.resetsAt * 1000 > at && Math.abs(weeklyAfter.resetsAt - weeklyBefore.resetsAt) < SAME_WINDOW_SLACK_SECONDS;
  if (!sameWindow) return [];
  const fableSameWindow = (before: VibeCodingLimit, after: VibeCodingLimit) =>
    before.resetsAt == null || after.resetsAt == null ||
    (before.resetsAt * 1000 > at && Math.abs(after.resetsAt - before.resetsAt) < SAME_WINDOW_SLACK_SECONDS);
  const share = (percent: number) => (percent * FABLE_WEEKLY_SHARE_PERCENT) / 100;
  const [fableBefore, fableAfter] = [fable(previous), fable(next)];
  const fableDrop = fableBefore && fableAfter && fableSameWindow(fableBefore, fableAfter) ? fableBefore.usedPercent - fableAfter.usedPercent : 0;
  if (fableBefore && fableDrop >= RESET_CARD_ROUNDING_PERCENT) {
    const fableCardFloor = weeklyBefore.usedPercent - share(fableDrop);
    if (weeklyAfter.usedPercent < fableCardFloor - RESET_CARD_ROUNDING_PERCENT) return ["standard"];
    const nonFableBefore = weeklyBefore.usedPercent - share(fableBefore.usedPercent);
    return nonFableBefore <= RESET_CARD_ROUNDING_PERCENT ? ["fable", "standard"] : ["fable"];
  }
  return weeklyBefore.usedPercent - weeklyAfter.usedPercent >= RESET_CARD_ROUNDING_PERCENT ? ["standard"] : [];
}

export function countResetCards(stock: ClaudeResetCardStock, at: number): ClaudeResetCards {
  const live = (expiries: number[]) => expiries.filter((expiresAt) => expiresAt * 1000 > at).length;
  return { fable: live(stock.fable), standard: live(stock.standard) };
}

// 划掉没过期里最早到期的那张：两张都能用时 lyjw 会先用快过期的。过期的顺手清掉。没有能用的返回 null。
export function spendResetCardFromStock(
  stock: ClaudeResetCardStock,
  kind: keyof ClaudeResetCardStock,
  at: number,
): ClaudeResetCardStock | null {
  const live = (expiries: number[]) => expiries.filter((expiresAt) => expiresAt * 1000 > at).sort((a, b) => a - b);
  const remaining = live(stock[kind]);
  if (!remaining.length) return null;
  return { fable: live(stock.fable), standard: live(stock.standard), [kind]: remaining.slice(1) };
}

export function parseClaudeResetCards(input: unknown): ClaudeResetCardStock {
  const root = object(input);
  if (!root) throw new Error("重置卡上报必须是对象");
  const expiries = (field: keyof ClaudeResetCardStock) => {
    const value = root[field];
    const valid = Array.isArray(value) && value.length <= MAX_RESET_CARDS &&
      value.every((expiresAt) => typeof expiresAt === "number" && Number.isInteger(expiresAt) && expiresAt > 0);
    if (!valid) throw new Error(`${field} 必须是至多 ${MAX_RESET_CARDS} 个过期时间（Unix 秒，正整数）的数组`);
    return value as number[];
  };
  return { fable: expiries("fable"), standard: expiries("standard") };
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
