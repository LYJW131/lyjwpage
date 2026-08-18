import { VIBECODING_ACTIVITY_LIMIT } from "@/lib/limits";
import { mirrorKey } from "@/lib/redis";
import { readLiveness, withPresence } from "@/lib/reporter-liveness";
import type {
  VibeCodingAgent,
  VibeCodingAgentId,
  VibeCodingDay,
  VibeCodingLimit,
  VibeCodingPayload,
  VibeCodingPlan,
  VibeCodingQuotaProvider,
  VibeCodingSessionsPayload,
  VibeCodingTotals,
} from "@/lib/types";

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

/**
 * 三个采集器三份存储，一份一个 key。
 *
 * 从前是一份：CodexBar 那个十几秒的用量扫描顺手把限额和会话状态烤进自己的载荷
 * 里，站点这边也就只有一个写入点。代价是三件事被绑成一件 —— 扫描失败时刚取到的
 * 限额连收都收不到，而「只更新限额」在协议上根本无法表达（校验是全有或全无的）。
 *
 * 现在各写各的，读的时候按 agent id 并回一份 VibeCodingPayload。读侧契约没变：
 * 一张卡、一个端点、一个形状。
 *
 * Redis 为主、进程内存为辅，规则见 lib/redis 的 mirrorKey。
 */
const usageMirror = mirrorKey<{ payload: StoredUsage; pushedAt: number }>(
  ["vibecoding", "usage"],
  (state) => state.pushedAt,
);
const limitsMirror = mirrorKey<{ payload: StoredLimits; pushedAt: number }>(
  ["vibecoding", "limits"],
  (state) => state.pushedAt,
);
const sessionsMirror = mirrorKey<{ payload: StoredSessions; pushedAt: number }>(
  ["vibecoding", "sessions"],
  (state) => state.pushedAt,
);

/** `codexbar cost` 出的本地用量。展示名不存 —— 读的时候由这边给。 */
type StoredUsage = {
  agents: Array<{
    id: VibeCodingAgentId;
    models: string[];
    /** 最近一个有用量日里的主力模型，是 sessions 那份取不到时的退路 */
    currentModel: string | null;
    topModel: string | null;
    activity: Array<{ t: number; tokens: number }>;
    today: VibeCodingDay;
    last30DaysTokens: number;
  }>;
  /** sessionCount 来自 ccusage，不在这份里 */
  totals: Omit<VibeCodingTotals, "sessionCount">;
  topModels: Array<{ model: string; tokens: number }>;
  collectedAt: string;
};

/** `codexbar usage` 出的套餐与限额窗口。 */
type StoredLimits = {
  agents: Array<{
    id: VibeCodingAgentId;
    plan: VibeCodingPlan | null;
    limits: VibeCodingLimit[];
    limitsError: string | null;
  }>;
  /** 上报器配了几个就是几个；名字和图标也是它给的，站点这边没有名单 */
  quotaProviders: VibeCodingQuotaProvider[];
};

/** `ccusage session` 出的此刻状态。 */
type StoredSessions = {
  agents: Array<{
    id: VibeCodingAgentId;
    currentModel: string | null;
    lastActivityAt: string | null;
    active: boolean;
  }>;
  sessionCount: number;
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

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** 在一个 raw 数组里按 `id` 找这个 agent / provider 那条 */
function rowById(rows: unknown, id: string): Record<string, unknown> | null {
  if (!Array.isArray(rows)) return null;
  const found = rows.find(
    (value) => object(value)?.id === id,
  );
  return object(found);
}

function text(value: unknown): string | null {
  return typeof value === "string" && value ? value : null;
}

/**
 * `vibeCodingUsage`：Mac Telemetry Hub 备好的、可直接展示的用量摘要。
 *
 * 这份的校验仍是全有或全无 —— 曲线和总量是一体的，缺一个 agent 或者桶数对不上
 * 就拼不出完整的一张图。限额和会话状态各有各的宽松校验，不受这道门闩牵连。
 */
function normalizeUsage(input: unknown): StoredUsage | null {
  const root = object(input);
  if (!root || !Array.isArray(root.agents) || !object(root.totals)) return null;

  const agents = AGENTS.flatMap((id): StoredUsage["agents"] => {
    const row = rowById(root.agents, id);
    if (!row) return [];
    const today = object(row.today);
    return [{
      id,
      models: Array.isArray(row.models)
        ? row.models.filter((model): model is string => typeof model === "string")
        : [],
      currentModel: text(row.currentModel),
      topModel: text(row.topModel),
      activity: normalizeActivity(row.activity),
      today: today
        ? normalizePreparedDay(text(today.date) ?? localDate(), today as RawAgentDay)
        : emptyDay(localDate()),
      last30DaysTokens: finite(row.last30DaysTokens),
    }];
  });
  if (
    agents.length !== AGENTS.length ||
    agents.some((agent) => agent.activity.length !== VIBECODING_ACTIVITY_LIMIT)
  ) {
    return null;
  }

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
 * `vibeCodingLimits`：套餐、限额窗口，以及只占一行总额度的附加 provider。
 *
 * 这份**不**要求两个 agent 齐全：一边取到、一边没取到是常态，缺的那边按
 * 「没配」渲染。整条命令全挂时上报器仍会发一份只有 limitsError 的载荷 ——
 * 空 limits 加上错误原因才是「配了但取不到」。
 *
 * 附加 provider 同理，而且连名单都不校验：上报器发几个就收几个，名字和图标
 * 一并收下。这边只逐行做类型收敛 —— 三样缺一的行落到页面上是一条没主的进度条。
 */
function normalizeLimitsReport(input: unknown): StoredLimits | null {
  const root = object(input);
  if (!root || !Array.isArray(root.agents)) return null;
  return {
    agents: AGENTS.flatMap((id): StoredLimits["agents"] => {
      const row = rowById(root.agents, id);
      if (!row) return [];
      return [{
        id,
        plan: normalizePlan(row.plan),
        limits: normalizeLimits(row.limits),
        limitsError: text(row.limitsError),
      }];
    }),
    quotaProviders: (Array.isArray(root.quotaProviders) ? root.quotaProviders : []).flatMap(
      (value): VibeCodingQuotaProvider[] => {
        const row = object(value);
        if (!row) return [];
        const id = text(row.id);
        const label = text(row.label);
        const icon = text(row.icon);
        if (!id || !label || !icon) return [];
        return [{
          id,
          label,
          icon,
          // 夹到 0–100：进度条宽度直接用它
          usedPercent: typeof row.usedPercent === "number" && Number.isFinite(row.usedPercent)
            ? Math.min(100, Math.max(0, row.usedPercent))
            : null,
          plan: normalizePlan(row.plan),
          resetsAt: positiveOrNull(row.resetsAt),
          limitsError: text(row.limitsError),
        }];
      },
    ),
  };
}

/** `vibeCodingSessions`：此刻在用哪个模型、活没活着、历史会话总数。 */
function normalizeSessions(input: unknown): StoredSessions | null {
  const root = object(input);
  if (!root || !Array.isArray(root.agents)) return null;
  return {
    agents: AGENTS.flatMap((id): StoredSessions["agents"] => {
      const row = rowById(root.agents, id);
      if (!row) return [];
      return [{
        id,
        currentModel: text(row.currentModel),
        lastActivityAt:
          typeof row.lastActivityAt === "string" && Number.isFinite(Date.parse(row.lastActivityAt))
            ? row.lastActivityAt
            : null,
        active: row.active === true,
      }];
    }),
    sessionCount: finite(root.sessionCount),
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
    const row = object(sample);
    if (!row) return [];
    const { t, tokens } = row as { t?: unknown; tokens?: unknown };
    return typeof t === "number" && Number.isFinite(t)
      ? [{ t, tokens: finite(tokens) }]
      : [];
  });
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

function positiveOrNull(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * 三个模块一律「先校验，后落库」，写留给 commit。
 *
 * 校验是同步的，所以整条信封的校验全部排在任何一次写之前 —— 后面一份写坏时，
 * 前面几份根本还没落库，不会留下半截状态（从前是逐份 await 落库、逐份失效缓存
 * 来补这个洞的）。而且写不再挡着推送，见 lib/live-events 的 fanout。
 */
export function prepareVibeCodingUsage(report: unknown, receivedAt = Date.now()) {
  const payload = normalizeUsage(report);
  if (!payload) throw new Error("vibeCodingUsage 必须是 Mac Telemetry Hub 的用量摘要");
  return { commit: () => usageMirror.put({ payload, pushedAt: receivedAt }) };
}

export function prepareVibeCodingLimits(report: unknown, receivedAt = Date.now()) {
  const payload = normalizeLimitsReport(report);
  if (!payload) throw new Error("vibeCodingLimits 必须带 agents 数组");
  return { commit: () => limitsMirror.put({ payload, pushedAt: receivedAt }) };
}

export function prepareVibeCodingSessions(report: unknown, receivedAt = Date.now()) {
  const payload = normalizeSessions(report);
  if (!payload) throw new Error("vibeCodingSessions 必须带 agents 数组");
  return {
    /** 推给浏览器的会话补丁。用量还没到过也推 —— 它不依赖那份 */
    sessions: {
      agents: payload.agents,
      sessionCount: payload.sessionCount,
    } satisfies VibeCodingSessionsPayload,
    commit: () => sessionsMirror.put({ payload, pushedAt: receivedAt }),
  };
}

/**
 * `since` 是客户端已有的最新活动桶时刻，只回传从它起的部分。
 *
 * 用 `>=` 而不是 `>`：桶是一天一个，边界那个还在累加，必须重发新值。
 * 更早的桶已经封口，不会再变，不用重复传。
 *
 * 新鲜度只盖 pushedAt / lastSeenAt / declaredOffline，stale 由浏览器现算。
 */
export async function getVibeCodingSnapshot(): Promise<VibeCodingPayload> {
  const [usageState, limitsState, sessionsState, liveness] = await Promise.all([
    usageMirror.get(),
    limitsMirror.get(),
    sessionsMirror.get(),
    readLiveness(),
  ]);
  // 用量是主干：曲线、总量、模型排行都在它那份里，缺了就没有卡片可言。
  // 限额和会话状态缺了只是少两块，各自降级，不连累整张卡。
  if (!usageState) throw new Error("尚未收到 Mac Telemetry Hub 的 CodexBar 推送");

  const limitsById = new Map(
    (limitsState?.payload.agents ?? []).map((agent) => [agent.id, agent]),
  );
  const sessionsById = new Map(
    (sessionsState?.payload.agents ?? []).map((agent) => [agent.id, agent]),
  );

  const agents: VibeCodingAgent[] = usageState.payload.agents.map((agent) => {
    const limits = limitsById.get(agent.id);
    const session = sessionsById.get(agent.id);
    return {
      id: agent.id,
      label: agent.id === "claude" ? "Claude Code" : "Codex",
      models: agent.models,
      // ccusage 说的是「此刻在用哪个」，取不到才退回用量那份的「最近一个有用量日
      // 的主力模型」。两个模块各送各的，优先级在这里定，采集端互不知情。
      currentModel: session?.currentModel ?? agent.currentModel,
      lastActivityAt: session?.lastActivityAt ?? null,
      active: session?.active ?? false,
      topModel: agent.topModel,
      activity: agent.activity,
      today: agent.today,
      plan: limits?.plan ?? null,
      // 没收到限额推送时是空数组加 null：页面据此当成「没配」，整块不渲染。
      // 「配了但取不到」由上报器送来的 limitsError 表达。
      limits: limits?.limits ?? [],
      limitsError: limits?.limitsError ?? null,
      last30DaysTokens: agent.last30DaysTokens,
    };
  });

  // Redis 里可能还躺着上一版形状的行 —— 站点先上线、Mac app 还没重启的那几个钟头。
  // 缺名字或图标的直接丢掉：渲染出一条没主的进度条比少一行难看得多，
  // 而下一次限额推送就把它们补回来了。
  const quotaProviders: VibeCodingQuotaProvider[] = (
    limitsState?.payload.quotaProviders ?? []
  ).filter((provider) => provider.label && provider.icon);

  return withPresence(
    {
      agents,
      quotaProviders,
      totals: {
        ...usageState.payload.totals,
        sessionCount: sessionsState?.payload.sessionCount ?? 0,
      },
      topModels: usageState.payload.topModels,
      collectedAt: usageState.payload.collectedAt,
      source: "push" as const,
      activityPartial: false,
      pushedAt: usageState.pushedAt,
    },
    liveness,
  );
}

/** 按客户端游标切活动曲线。不重读 Redis。 */
export function sliceVibeCodingActivity(
  payload: VibeCodingPayload,
  since?: number,
): VibeCodingPayload {
  const oldest = Math.min(
    ...payload.agents.map((agent) => agent.activity[0]?.t ?? Number.POSITIVE_INFINITY),
  );
  const activityPartial = since != null && Number.isFinite(oldest) && since >= oldest;
  if (!activityPartial) return { ...payload, activityPartial: false };

  return {
    ...payload,
    activityPartial: true,
    agents: payload.agents.map((agent) => ({
      ...agent,
      activity: agent.activity.filter((point) => point.t >= since),
    })),
  };
}

export async function getVibeCodingPayload(
  { since }: { since?: number } = {},
): Promise<VibeCodingPayload> {
  return sliceVibeCodingActivity(await getVibeCodingSnapshot(), since);
}
