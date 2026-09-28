/**
 * 各 agent 限额那份的纯逻辑：按 id 合并、按 id 贴回用量行。
 *
 * 限额在可滞后层（KV `limits:v1`，`/api/status/limits`）：上报入口收到
 * `/api/ingest/agents` 时按 id 合并后整份写回，浏览器取回后按 id 贴到
 * `/api/status/vibecoding` 的用量行上。只 import 类型，浏览器、Worker、单测都能用。
 */

import type { VibeCodingAgent, VibeCodingLimit, VibeCodingPlan, VibeCodingUsageAgent } from "./types.ts";
import type { ParsedAgentLimits } from "./vibecoding-parse.ts";

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

/** 从没上报过限额的 agent 长这样：空 limits、无错误，页面按「没配」渲染 */
const NO_LIMITS = {
  plan: null,
  limits: [] as VibeCodingLimit[],
  limitsError: null,
  limitsAt: null,
} as const;

/** 限额接口只报 id；尚无用量时用这些展示名，未知来源直接显示其 id。 */
const AGENT_BRANDS: Record<string, { label: string; icon: string }> = {
  claude: { label: "Claude Code", icon: "anthropic" },
  codex: { label: "Codex", icon: "openai" },
  cursor: { label: "Cursor", icon: "cursor" },
  grok: { label: "Grok Build", icon: "grok" },
  antigravity: { label: "Antigravity", icon: "antigravity" },
};

/** 没有用量摘要的来源（只有限额、或只有此刻）也要一行：品牌名、未知用量 */
export function placeholderAgent(id: string): VibeCodingUsageAgent {
  return {
    id,
    ...(Object.hasOwn(AGENT_BRANDS, id) ? AGENT_BRANDS[id] : { label: id, icon: id }),
    models: [],
    currentModel: null,
    topModel: null,
    today: null,
    lastActivityAt: null,
    active: false,
    usageStatus: {
      state: "unavailable",
      collectedAt: null,
      error: null,
      warning: null,
      coverageStart: null,
      coverageEnd: null,
      precision: "measured",
      costComplete: false,
    },
  };
}

/** 按来源合并。只有限额的来源保留一行，未知用量用 null 表示。 */
export function attachAgentLimits(
  agents: VibeCodingUsageAgent[],
  stored: AgentLimitsPayload | null,
): VibeCodingAgent[] {
  const merged = agents.slice();
  const ids = new Set(agents.map((agent) => agent.id));
  for (const id of Object.keys(stored?.agents ?? {})) {
    if (!ids.has(id)) merged.push(placeholderAgent(id));
  }
  return merged.map((agent) => {
    const row = stored?.agents[agent.id];
    if (!row) return { ...agent, ...NO_LIMITS };
    return {
      ...agent,
      plan: row.plan,
      limits: row.limits,
      limitsError: row.limitsError,
      limitsAt: row.updatedAt,
    };
  });
}
