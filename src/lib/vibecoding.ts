import type {
  VibeCodingAgent,
  VibeCodingAgentId,
  VibeCodingDay,
  VibeCodingPayload,
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
      last7Days,
      last30DaysTokens: finite(row.last30DaysTokens),
    }];
  });
  if (
    agents.length !== AGENTS.length ||
    agents.some((agent) => agent.last7Days.length !== 7 || agent.activity.length !== 60)
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

export function recordVibeCodingReport(report: unknown, receivedAt = Date.now()) {
  const prepared = normalizePreparedSummary(report, "push");
  if (!prepared) throw new Error("vibe_coding 必须是 Mac Telemetry Hub v2 聚合摘要");
  pushed = prepared;
  pushedAt = receivedAt;
}

export async function getVibeCodingPayload(): Promise<VibeCodingPayload> {
  // Mac Telemetry Hub 是唯一采集端；没有推送就明确报错，不静默切换数据源。
  if (!pushed) throw new Error("尚未收到 Mac Telemetry Hub 的 ccusage 推送");
  return {
    ...pushed,
    stale: Date.now() - pushedAt > PUSH_STALE_MS,
  };
}
