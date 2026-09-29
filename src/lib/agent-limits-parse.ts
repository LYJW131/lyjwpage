/**
 * `/api/ingest/agents` 顶层 `agents`（容器上报器报来的各 agent 账号套餐与限额窗口）的类型收敛。
 *
 * 一行一个 agent，按 id 贴到卡片的对应行上（lib/vibecoding-limits）；token 用量另走
 * `codingUsage` 那三键（shared/coding-usage），不在这里。校验是纯函数，测试和入口走同一条。
 */

import { object, text } from "./json.ts";
import type { VibeCodingLimit, VibeCodingPlan } from "./types.ts";

/** `/api/ingest/agents` 一封里的一行：某个 agent 此刻的套餐与限额窗口。 */
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
  // 展示名缺了就退回原始枚举值：难看总好过整块套餐信息消失
  return { tier, label: text(row.label) ?? tier };
}

/**
 * 窗口的个数和时长完全由上游决定，所以这里只逐条做类型收敛，不校验数量、
 * 不认识任何具体窗口。
 */
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
      // 夹到 0–100：进度条宽度直接用它，上游给出界的值会把整块布局撑坏
      usedPercent: Math.min(100, Math.max(0, row.usedPercent)),
      resetsAt: positiveOrNull(row.resetsAt),
    }];
  });
}

/**
 * 容器上报器这一轮取到的各 agent 套餐与限额窗口。
 *
 * 只带这次采集到的 agent，没出现的 id 站点不动（合并在 lib/vibecoding-limits）。
 * 一行要有 id；`plan` 缺了是 null；`limits` 逐条收敛、坏行丢掉；`limits` 空且
 * `limitsError` 非空才是「配了但取不到」。
 * 一封里 id 重复或一行都没有：整封不收 —— 上报器发空封没有意义，多半是它那边坏了。
 */
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
