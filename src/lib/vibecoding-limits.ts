/**
 * 各 agent 限额那份的纯逻辑：按 id 合并、按 id 贴回用量行。
 *
 * 不碰 Redis、不碰 Next：lib/vibecoding 只负责把这里的结果放进镜像、从镜像取出，
 * 所以这两个函数能直接进单测。
 */

import type { VibeCodingAgent, VibeCodingLimit, VibeCodingPlan } from "./types.ts";
import type { ParsedAgentLimits } from "./vibecoding-parse.ts";

/** 镜像里一行：某个 agent 最近一次上报的套餐与窗口，以及站点收到它的时刻 */
export type StoredAgentLimitsRow = {
  plan: VibeCodingPlan | null;
  limits: VibeCodingLimit[];
  limitsError: string | null;
  /** 站点收到这一行的时刻。上报器每轮必发，它就是这行的心跳 */
  pushedAt: number;
};

export type StoredAgentLimits = {
  agents: Record<string, StoredAgentLimitsRow>;
  /** 最近一封到达的时刻，镜像的新鲜度看它 */
  pushedAt: number;
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
  previous: StoredAgentLimits | null,
  incoming: ParsedAgentLimits,
  receivedAt: number,
): StoredAgentLimits {
  const agents: Record<string, StoredAgentLimitsRow> = { ...(previous?.agents ?? {}) };
  for (const row of incoming.agents) {
    agents[row.id] = {
      plan: row.plan,
      limits: row.limits,
      limitsError: row.limitsError,
      pushedAt: receivedAt,
    };
  }
  return { agents, pushedAt: receivedAt };
}

/** 从没上报过限额的 agent 长这样：空 limits、无错误，页面按「没配」渲染 */
const NO_LIMITS = {
  plan: null,
  limits: [] as VibeCodingLimit[],
  limitsError: null,
  limitsAt: null,
} as const;

/**
 * 把限额贴回用量行。用量那份是主干（展示名、图标、今日 token 都在那里），
 * 限额里有、用量里没有的 id 不产生新行。
 */
export function attachAgentLimits<
  T extends Omit<VibeCodingAgent, "plan" | "limits" | "limitsError" | "limitsAt">,
>(
  agents: T[],
  stored: StoredAgentLimits | null,
): Array<T & Pick<VibeCodingAgent, "plan" | "limits" | "limitsError" | "limitsAt">> {
  return agents.map((agent) => {
    const row = stored?.agents[agent.id];
    if (!row) return { ...agent, ...NO_LIMITS };
    return {
      ...agent,
      plan: row.plan,
      limits: row.limits,
      limitsError: row.limitsError,
      limitsAt: row.pushedAt,
    };
  });
}
