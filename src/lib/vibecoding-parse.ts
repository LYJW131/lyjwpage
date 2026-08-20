/**
 * `vibeCodingUsage` / `vibeCodingNow` 信封的类型收敛。
 *
 * 五个来源（Claude Code、Codex、Cursor、Grok、Antigravity）走同一套 agent
 * 形状：token、今日用量、套餐、限额窗口、展示名、图标都在行内。站点按需取用，
 * 不要再拆 `quotaProviders` —— 那是按展示形态裁过的字段，加一列明细就要
 * 改信封。
 *
 * 这份文件不碰 Redis：校验是纯函数，测试和入库走同一条。
 */

import { object, text } from "./json.ts";
import type {
  VibeCodingDay,
  VibeCodingLimit,
  VibeCodingPlan,
  VibeCodingTotals,
} from "./types.ts";

type RawAgentDay = {
  inputTokens?: unknown;
  outputTokens?: unknown;
  cacheReadTokens?: unknown;
  cacheCreationTokens?: unknown;
  totalTokens?: unknown;
  apiEquivalentCostUSD?: unknown;
};

export type ParsedVibeCodingUsage = {
  agents: Array<{
    id: string;
    label: string;
    icon: string;
    models: string[];
    currentModel: string | null;
    topModel: string | null;
    today: VibeCodingDay;
    plan: VibeCodingPlan | null;
    limits: VibeCodingLimit[];
    limitsError: string | null;
  }>;
  totals: Omit<VibeCodingTotals, "sessionCount"> & { sessionCount?: number };
  topModels: Array<{ model: string; tokens: number }>;
  collectedAt: string;
};

export type ParsedVibeCodingNow = {
  agents: Array<{
    id: string;
    currentModel: string | null;
    lastActivityAt: string | null;
    active: boolean;
  }>;
};

function finite(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : 0;
}

function emptyDay(date: string): VibeCodingDay {
  return {
    date,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 0,
    apiEquivalentCostUSD: 0,
  };
}

function localDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function positiveOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function normalizePreparedDay(date: string, raw: RawAgentDay): VibeCodingDay {
  const inputTokens = finite(raw.inputTokens);
  const outputTokens = finite(raw.outputTokens);
  const cacheReadTokens = finite(raw.cacheReadTokens);
  const cacheCreationTokens = finite(raw.cacheCreationTokens);
  const totalTokens = finite(raw.totalTokens);
  return {
    date,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheCreationTokens,
    totalTokens: totalTokens || inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens,
    apiEquivalentCostUSD: finite(raw.apiEquivalentCostUSD),
  };
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
 * 窗口的个数和时长完全由上游决定（Codex 眼下只有周窗口，5 小时窗口以后可能回来），
 * 所以这里只逐条做类型收敛，不校验数量、不认识任何具体窗口。
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

function normalizeAgent(row: Record<string, unknown>): ParsedVibeCodingUsage["agents"][number] | null {
  const id = text(row.id);
  const label = text(row.label);
  const icon = text(row.icon);
  if (!id || !label || !icon) return null;

  const today = object(row.today);
  return {
    id,
    label,
    icon,
    models: Array.isArray(row.models)
      ? row.models.filter((model): model is string => typeof model === "string")
      : [],
    currentModel: text(row.currentModel),
    topModel: text(row.topModel),
    today: today
      ? normalizePreparedDay(text(today.date) ?? localDate(), today as RawAgentDay)
      : emptyDay(localDate()),
    plan: normalizePlan(row.plan),
    limits: normalizeLimits(row.limits),
    limitsError: text(row.limitsError),
  };
}

/**
 * `vibeCodingUsage`：Mac Telemetry Hub 备好的、可直接展示的累计量。
 *
 * 行与行同一形状，不认固定名单。**整份是全有或全无的**：某一行缺展示名或图标，
 * 总量就对不上，整份不收。限额那半校验仍是宽松的 ——
 * 一边取到、一边没取到是常态，缺的那边按「没配」渲染；整条限额都挂了时上报器
 * 仍会带上只有 limitsError 的行，空 limits 加上错误原因才是「配了但取不到」。
 *
 * 不再读 `quotaProviders`。限额窗口留在 `agents[].limits` 里，站点自己挑哪一条
 * 当总限额条。
 */
export function normalizeVibeCodingUsage(input: unknown): ParsedVibeCodingUsage | null {
  const root = object(input);
  if (!root || !Array.isArray(root.agents) || !object(root.totals)) return null;

  const seen = new Set<string>();
  const agents: ParsedVibeCodingUsage["agents"] = [];
  for (const value of root.agents) {
    const row = object(value);
    const agent = row ? normalizeAgent(row) : null;
    if (!agent || seen.has(agent.id)) return null;
    seen.add(agent.id);
    agents.push(agent);
  }
  if (agents.length === 0) return null;

  const rawTotals = root.totals as Record<string, unknown>;
  return {
    agents,
    totals: {
      inputTokens: finite(rawTotals.inputTokens),
      outputTokens: finite(rawTotals.outputTokens),
      cacheReadTokens: finite(rawTotals.cacheReadTokens),
      cacheCreationTokens: finite(rawTotals.cacheCreationTokens),
      reasoningTokens: finite(rawTotals.reasoningTokens),
      totalTokens: finite(rawTotals.totalTokens),
      apiEquivalentCostUSD: finite(rawTotals.apiEquivalentCostUSD),
      activeDays: finite(rawTotals.activeDays),
      // 会话总数由 60 秒那轮扫出来，搭这份的车发过来 —— 它是「一共开过多少次」，
      // 累计量归累计量那份，不该混进说「此刻」的 now 里
      sessionCount: finite(rawTotals.sessionCount),
    },
    topModels: Array.isArray(root.topModels)
      ? root.topModels.flatMap((value) => {
          const row = object(value);
          const model = row ? text(row.model) : null;
          return model ? [{ model, tokens: finite(row?.tokens) }] : [];
        }).slice(0, 3)
      : [],
    collectedAt:
      typeof root.collectedAt === "string" && Number.isFinite(Date.parse(root.collectedAt))
        ? root.collectedAt
        : new Date().toISOString(),
  };
}

/**
 * `vibeCodingNow`：此刻在用哪个模型、活没活着。
 *
 * 同样不认固定名单，按 id 并回用量那份。某一行缺 id 就跳过，不拖垮其余几盏灯。
 */
export function normalizeVibeCodingNow(input: unknown): ParsedVibeCodingNow | null {
  const root = object(input);
  if (!root || !Array.isArray(root.agents)) return null;

  const byId = new Map<string, ParsedVibeCodingNow["agents"][number]>();
  for (const value of root.agents) {
    const row = object(value);
    const id = row ? text(row.id) : null;
    if (!row || !id) continue;
    byId.set(id, {
      id,
      currentModel: text(row.currentModel),
      lastActivityAt:
        typeof row.lastActivityAt === "string" && Number.isFinite(Date.parse(row.lastActivityAt))
          ? row.lastActivityAt
          : null,
      active: row.active === true,
    });
  }
  return { agents: [...byId.values()] };
}
