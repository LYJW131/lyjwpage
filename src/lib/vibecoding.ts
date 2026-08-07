import type {
  VibeCodingAgent,
  VibeCodingAgentId,
  VibeCodingDay,
  VibeCodingLimit,
  VibeCodingPayload,
  VibeCodingPlan,
} from "@/lib/types";

const PUSH_STALE_MS = 15 * 60_000;
const AGENTS: VibeCodingAgentId[] = ["claude", "codex"];

type RawAgentDay = {
  agent?: unknown;
  inputTokens?: unknown;
  outputTokens?: unknown;
  cacheReadTokens?: unknown;
  cacheCreationTokens?: unknown;
  totalTokens?: unknown;
  totalCost?: unknown;
  modelsUsed?: unknown;
  models?: unknown;
  modelBreakdowns?: unknown;
  reasoningOutputTokens?: unknown;
};

let pushed: VibeCodingPayload | null = null;
let pushedAt = 0;

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

/** Accept the bounded, display-ready summary produced by Mac Telemetry Hub. */
function normalizePreparedSummary(
  input: unknown,
  source: VibeCodingPayload["source"],
): VibeCodingPayload | null {
  if (!input || typeof input !== "object") return null;
  const root = input as Record<string, unknown>;
  if (!Array.isArray(root.agents) || !root.totals || typeof root.totals !== "object") {
    return null;
  }
  const rawAgents = root.agents as unknown[];

  const agents = AGENTS.flatMap((id): VibeCodingAgent[] => {
    const raw = rawAgents.find(
      (value) => value && typeof value === "object" && (value as { id?: unknown }).id === id,
    );
    if (!raw || typeof raw !== "object") return [];
    const row = raw as Record<string, unknown>;
    const last7Days = Array.isArray(row.last7Days)
      ? row.last7Days.flatMap((value) => {
          if (!value || typeof value !== "object") return [];
          const day = value as RawAgentDay & { date?: unknown };
          return typeof day.date === "string" ? [normalizePreparedDay(day.date, day)] : [];
        })
      : [];
    const today =
      row.today && typeof row.today === "object"
        ? normalizePreparedDay(
            typeof (row.today as { date?: unknown }).date === "string"
              ? ((row.today as { date: string }).date)
              : localDate(),
            row.today as RawAgentDay,
          )
        : emptyDay(localDate());

    return [{
      id,
      label: id === "claude" ? "Claude Code" : "Codex",
      models: Array.isArray(row.models)
        ? row.models.filter((model): model is string => typeof model === "string")
        : [],
      currentModel: typeof row.currentModel === "string" ? row.currentModel : null,
      lastActivityAt:
        typeof row.lastActivityAt === "string" && Number.isFinite(Date.parse(row.lastActivityAt))
          ? row.lastActivityAt
          : null,
      activity: normalizeActivity(row.activity),
      today,
      // 这两个是后加的字段，旧版 Mac app 的上报里根本没有。缺失一律降级成
      // 「没有数据」，绝不能进下面那道拒收门闩 —— 那样现存客户端每次上报都会 400。
      plan: normalizePlan(row.plan),
      limits: normalizeLimits(row.limits),
      last7Days,
      last30DaysTokens: finite(row.last30DaysTokens),
    }];
  });
  if (
    agents.length !== AGENTS.length ||
    agents.some((agent) => agent.last7Days?.length !== 7 || agent.activity.length !== 60)
  ) {
    return null;
  }

  const rawTotals = root.totals as Record<string, unknown>;
  const topModels = Array.isArray(root.topModels)
    ? root.topModels.flatMap((value) => {
        if (!value || typeof value !== "object") return [];
        const row = value as Record<string, unknown>;
        return typeof row.model === "string"
          ? [{ model: row.model, tokens: finite(row.tokens) }]
          : [];
      }).slice(0, 3)
    : [];
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
      sessions: finite(rawTotals.sessions),
    },
    topModels,
    collectedAt:
      typeof root.collectedAt === "string" && Number.isFinite(Date.parse(root.collectedAt))
        ? root.collectedAt
        : new Date().toISOString(),
    source,
    // 两个都是读取时才算的，存的时候只占位
    activityPartial: false,
    stale: false,
  };
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
    apiEquivalentCostUSD: finite(
      (raw as RawAgentDay & { apiEquivalentCostUSD?: unknown }).apiEquivalentCostUSD,
    ),
  };
}

function localDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeActivity(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((sample) => {
    if (!sample || typeof sample !== "object") return [];
    const { t, tokens } = sample as { t?: unknown; tokens?: unknown };
    return typeof t === "number" && Number.isFinite(t)
      ? [{ t, tokens: finite(tokens) }]
      : [];
  });
}

function normalizePlan(value: unknown): VibeCodingPlan | null {
  if (!value || typeof value !== "object") return null;
  const { tier, label } = value as { tier?: unknown; label?: unknown };
  if (typeof tier !== "string" || !tier) return null;
  // 展示名缺了就退回原始枚举值：难看总好过整块套餐信息消失
  return { tier, label: typeof label === "string" && label ? label : tier };
}

/**
 * 窗口的个数和时长完全由上游决定（Codex 眼下只有周窗口，5 小时窗口以后可能回来），
 * 所以这里只逐条做类型收敛，不校验数量、不认识任何具体窗口。
 */
function normalizeLimits(value: unknown): VibeCodingLimit[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): VibeCodingLimit[] => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Record<string, unknown>;
    if (typeof row.key !== "string" || !row.key) return [];
    if (typeof row.usedPercent !== "number" || !Number.isFinite(row.usedPercent)) return [];
    return [{
      key: row.key,
      label: typeof row.label === "string" && row.label ? row.label : null,
      group: typeof row.group === "string" && row.group ? row.group : null,
      windowMinutes: positiveOrNull(row.windowMinutes),
      // 夹到 0–100：进度条宽度直接用它，上游给出界的值会把整块布局撑坏
      usedPercent: Math.min(100, Math.max(0, row.usedPercent)),
      resetsAt: positiveOrNull(row.resetsAt),
    }];
  });
}

function positiveOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

export function recordVibeCodingReport(report: unknown, receivedAt = Date.now()) {
  const prepared = normalizePreparedSummary(report, "push");
  if (!prepared) throw new Error("vibe_coding 必须是 Mac Telemetry Hub v2 聚合摘要");
  pushed = prepared;
  pushedAt = receivedAt;
}

/**
 * `since` 是客户端已有的最新活动桶时刻，只回传从它起的部分。
 *
 * 用 `>=` 而不是 `>`：桶是 12 小时聚合，边界那个还在累加，必须重发新值。
 * 更早的桶已经封口，不会再变，不用重复传。
 */
export async function getVibeCodingPayload(
  { since }: { since?: number } = {},
): Promise<VibeCodingPayload> {
  // Mac Telemetry Hub 是唯一采集端；没有推送就明确报错，不静默切换数据源。
  if (!pushed) throw new Error("尚未收到 Mac Telemetry Hub 的 ccusage 推送");

  // 客户端落后太多、最旧的桶都已经滚出窗口时拼不出连续曲线，只能整份重发
  const oldest = Math.min(
    ...pushed.agents.map((agent) => agent.activity[0]?.t ?? Number.POSITIVE_INFINITY),
  );
  const activityPartial =
    since != null && Number.isFinite(oldest) && since >= oldest;

  return {
    ...pushed,
    // last7Days 只服务于入库校验，页面不用，别塞进响应
    agents: pushed.agents.map((agent) => ({
      ...agent,
      last7Days: undefined,
      activity: activityPartial
        ? agent.activity.filter((point) => point.t >= since)
        : agent.activity,
    })),
    activityPartial,
    stale: Date.now() - pushedAt > PUSH_STALE_MS,
  };
}
