/**
 * 各 agent 限额那份的纯逻辑：按 id 合并、按 id 取出贴到卡片行上。
 *
 * 限额在可滞后层（KV `limits:v1`，`/api/status/limits`）：上报入口收到
 * `/api/ingest/agents` 时按 id 合并后整份写回，浏览器取回后按 id 贴到 coding 卡片的
 * agent 行上（lib/coding-agents 的 codingAgentRows）。只 import 类型，浏览器、Worker、单测都能用。
 */

import type { VibeCodingLimit, VibeCodingPlan } from "./types.ts";
import type { ParsedAgentLimits } from "./agent-limits-parse.ts";

/** 一行：某个 agent 最近一次上报的套餐与窗口，以及上报入口收到它的时刻 */
export type AgentLimitsRow = {
  plan: VibeCodingPlan | null;
  limits: VibeCodingLimit[];
  limitsError: string | null;
  /** 上报入口收到这一行的时刻。上报器每轮必发，它就是这行的心跳 */
  updatedAt: number;
};

/** `/api/status/limits` 的 data */
export type AgentLimitsPayload = {
  agents: Record<string, AgentLimitsRow>;
};

/**
 * 一封只带这次采集到的 agent，没出现的 id 保留上一次的值。
 *
 * 出现了的行整行替换，不做字段级合并：上报器只报事实，取失败时发的是空 limits
 * 加 limitsError，站点这边要照实记下「现在取不到」，而不是把旧窗口留着当新的。
 * 上一次的好值不需要在这里保护 —— 页面上那根条本来就该跟着 limitsError 一起翻成
 * Unavailable。
 */
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

/** 首屏布局只看有哪几个来源：限额里出现新 id 或少了 id 才算布局变了 */
export function agentLimitsLayoutKey(payload: AgentLimitsPayload | null): string {
  return JSON.stringify(Object.keys(payload?.agents ?? {}).sort());
}

/** 贴到一行上的限额四个字段 */
export type AgentLimitFields = {
  /** 套餐取不到、或这个 agent 从没上报过限额时是 null —— 不渲染，不占位 */
  plan: VibeCodingPlan | null;
  /** 没登录、凭据失效、从没上报过都会是空数组，UI 要能整块不渲染 */
  limits: VibeCodingLimit[];
  /**
   * 限额取失败的原因。空 limits 有两种含义 —— 这个 agent 没配（该整块不渲染），
   * 或者配了但取不到（该渲染并说明取不到）。靠它区分，null 表示前者。
   */
  limitsError: string | null;
  /**
   * 上报入口收到这个 agent 限额的时刻（epoch 毫秒），从没收到过是 null。
   * 过没过时由浏览器拿它和 `AGENT_LIMITS_STALE_MS` 现算，过了显示 Unavailable。
   */
  limitsAt: number | null;
};

/** 从没上报过限额的 agent 长这样：空 limits、无错误，页面按「没配」渲染 */
const NO_LIMITS: AgentLimitFields = {
  plan: null,
  limits: [],
  limitsError: null,
  limitsAt: null,
};

/** 某个 agent 的限额；这一份还没到、或它从没上报过限额时按「没配」 */
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
