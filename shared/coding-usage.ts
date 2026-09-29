import { object } from "@/lib/json";

/**
 * coding agent token 用量的跨端契约：三种原始事实的类型与校验。
 *
 * 来源（Mac Hub、agents-reporter 里的 Cursor、状态核心替 Claude Code 云端 OTLP 做的差值）只报自己
 * 观测到的事实，带着自己的来源名（= 上报入口，见 shared/coding-usage-sources）。合计、排名、
 * 去重、「今天」、年度格子都不归来源，在状态核心一处算（shared/coding-usage-view）。
 *
 * - 日行 `CodingUsageDay`：(来源, agent, 站点日)。一封里出现的 (来源, agent) **整份替换**全部日子；
 *   有行全 0 = 确认那天没用，没有行 = 未知。
 * - 5 分钟桶 `CodingTokenBucketReport`：(来源, agent, 模型, 5 分钟)。报告 `[from, to)` 范围内以这封为准，
 *   缺席的桶 = 0；范围外不动。只管 Pulse 速率和 Jev，不汇成日。
 * - 活动 `CodingActivityReport`：(来源, agent) 最近一条用量事件的时刻与模型，整份替换。
 *
 * 时刻一律 epoch 毫秒，日期一律 `YYYY-MM-DD`（Asia/Shanghai 站点日），字段 camelCase。
 *
 * 校验全有或全无，只针对这一个模块：哪条不合规就抛出带路径的原因（如
 * `agents[1].days[3].totalTokens 小于四列之和`），入口据此只丢这一个模块、把原因写进回执的
 * `rejected`（shared/ingest/coding）。可空字段缺省按 null 收：Swift 的编码器省掉 nil。
 */

export type CodingUsageDay = {
  /** Asia/Shanghai 站点日，YYYY-MM-DD */
  date: string;
  /** 不含缓存读写 */
  inputTokens: number;
  /** 含 reasoning */
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  /** outputTokens 的子集；来源不分就是 0 */
  reasoningTokens: number;
  /** ≥ 前四列之和，多出来的是来源没分列的量 */
  totalTokens: number;
  /** 已估到价的那部分，按公开 API 价估算；不是账单 */
  apiEquivalentCostUSD: number;
  /** 这一天所有有 token 的请求都估到了价 */
  costComplete: boolean;
  /** tokens > 0、model 唯一、合计 ≤ totalTokens；按来源的模型 id，不做跨来源别名 */
  models: Array<{ model: string; tokens: number }>;
};

/** 一个 agent 在一个来源里的账本。days 是这个 (来源, id) 的完整历史，整份替换。 */
export type CodingUsageAgent = {
  /** claude / codex / cursor / grok / antigravity / opencode / pi …，不写死名单 */
  id: string;
  state: "ok" | "error";
  /** 最近一次成功采集；从没成功过为 null。state = ok 时必有 */
  collectedAt: number | null;
  /** state = error：这一轮什么都没采到的原因 */
  error: string | null;
  /** 采到了但有缺口（token 未分列、历史变短而保留旧日子……） */
  warning: string | null;
  /** 这个来源截至此刻见过的不同会话数（累计量）；没有会话概念（Cursor）为 null */
  sessionCount: number | null;
  /** state = ok 必带（按日期升序）；state = error 必须缺省：只更新状态，历史不动 */
  days?: CodingUsageDay[];
};

/** Mac `modules.codingUsage` 与 `/api/ingest/agents` 的顶层 `codingUsage`。出现的 agent 整份替换，没出现的不动。 */
export type CodingUsageReport = { agents: CodingUsageAgent[] };

/** 此刻：各 agent 最近一条用量事件。内容不变也至少每 5 分钟重发一次，collectedAt 前进 = 采集器还活着。 */
export type CodingActivityReport = {
  collectedAt: number;
  /** lastActivityAt 为 null = 这个来源从没见过它的用量事件 */
  agents: Array<{ id: string; lastActivityAt: number | null; model: string | null }>;
};

export type CodingTokenBucketState = "ok" | "partial" | "unavailable";

export type CodingTokenBucketRow = {
  id: string;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  reasoningTokens: number;
  /** 去重后的用量事件数；来源数不出来（OTLP）为 null */
  eventCount: number | null;
};

/** 5 分钟 token 桶。[from, to) 范围内以这封为准（缺席的桶 = 0），范围外不动。 */
export type CodingTokenBucketReport = {
  from: number;
  /** ≤ collectedAt，to - from ≤ 25 小时 */
  to: number;
  collectedAt: number;
  /** 这封覆盖了哪些 agent、各自完整不完整；窗口里的行只能是这里列出的 agent */
  agents: Array<{ id: string; state: CodingTokenBucketState }>;
  /** 按 from 升序 */
  windows: Array<{
    /** CODING_BUCKET_MS 的整数倍，桶是 [from, from + 5 分钟) */
    from: number;
    agents: CodingTokenBucketRow[];
  }>;
};

/** 桶长 */
export const CODING_BUCKET_MS = 300_000;
/** 最近一条用量事件在这么久之内，就算这个 agent 在跑（活动灯、Pulse 的 Coding 观测同一条线） */
export const CODING_ACTIVE_MS = 5 * 60_000;
/**
 * 只管 Mac：它的活动报告内容不变也至少 5 分钟重发一次，采集时刻超过这么久没前进，Coding 观测里的
 * agent 当未知。agents 来源（Cursor）的活动跟着限额轮按人数调频，闲着时一小时才一封，不用这条线：
 * 它的新鲜度按账号观测自己的覆盖算（shared/pulse-cursor 的 CURSOR_OBSERVATION_HOLD_MS）。
 */
export const CODING_ACTIVITY_STALE_MS = 10 * 60_000;

const AGENT_ID = /^[a-z0-9][a-z0-9._-]{0,39}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** 时刻最多比收到时刻晚这么多（两边的钟不完全对齐） */
const FUTURE_SLACK_MS = 60_000;
const MAX_REPORT_SPAN_MS = 25 * 3_600_000;
const MAX_AGENTS = 64;
const MAX_DAYS = 4_000;
const MAX_DAY_MODELS = 64;
const MAX_WINDOWS = 400;
const MAX_WINDOW_ROWS = 64;
const MAX_MODEL_LENGTH = 200;
/** error / warning 按码点截到这么长：原因的长短由采集工具的输出决定，不是来源的毛病，截断不报错 */
const MAX_NOTE_LENGTH = 500;

function fail(path: string, message: string): never {
  throw new Error(path ? `${path} ${message}` : message);
}

function record(value: unknown, path: string): Record<string, unknown> {
  return object(value) ?? fail(path, "必须是对象");
}

function list(value: unknown, path: string, max: number): unknown[] {
  if (!Array.isArray(value)) fail(path, "必须是数组");
  if (value.length > max) fail(path, `最多 ${max} 条`);
  return value;
}

function count(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) fail(path, "必须是非负安全整数");
  return value;
}

function nullableCount(value: unknown, path: string): number | null {
  return value == null ? null : count(value, path);
}

function epochMs(value: unknown, path: string, receivedAt: number): number {
  const at = count(value, path);
  if (at > receivedAt + FUTURE_SLACK_MS) fail(path, "晚于收到时刻超过 60 秒");
  return at;
}

function agentId(value: unknown, path: string): string {
  if (typeof value !== "string" || !AGENT_ID.test(value)) fail(path, "必须匹配 ^[a-z0-9][a-z0-9._-]{0,39}$");
  return value;
}

/** 模型名原样收：空串、`unknown` 这类占位由视图按 shared/coding-models 隐藏，不在入口改写 */
function modelName(value: unknown, path: string): string {
  if (typeof value !== "string") fail(path, "必须是字符串");
  if (value.length > MAX_MODEL_LENGTH) fail(path, `超过 ${MAX_MODEL_LENGTH} 个字符`);
  return value;
}

function nullableModel(value: unknown, path: string): string | null {
  return value == null ? null : modelName(value, path);
}

function note(value: unknown, path: string): string | null {
  if (value == null) return null;
  if (typeof value !== "string") fail(path, "必须是字符串或 null");
  const trimmed = value.trim();
  if (!trimmed) return null;
  const points = [...trimmed];
  return points.length > MAX_NOTE_LENGTH ? points.slice(0, MAX_NOTE_LENGTH).join("") : trimmed;
}

function siteDate(value: unknown, path: string): string {
  if (typeof value !== "string" || !DATE.test(value)) fail(path, "必须是 YYYY-MM-DD");
  const stamp = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(stamp) || new Date(stamp).toISOString().slice(0, 10) !== value) fail(path, "不是合法日期");
  return value;
}

function cost(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) fail(path, "必须是有限非负数");
  return value;
}

function flag(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail(path, "必须是布尔值");
  return value;
}

/** 四列 token 与 reasoning：各自非负安全整数，reasoning 是 output 的子集 */
function tokenColumns(row: Record<string, unknown>, path: string) {
  const columns = {
    inputTokens: count(row.inputTokens, `${path}.inputTokens`),
    outputTokens: count(row.outputTokens, `${path}.outputTokens`),
    cacheReadTokens: count(row.cacheReadTokens, `${path}.cacheReadTokens`),
    cacheCreationTokens: count(row.cacheCreationTokens, `${path}.cacheCreationTokens`),
    reasoningTokens: count(row.reasoningTokens, `${path}.reasoningTokens`),
  };
  if (columns.reasoningTokens > columns.outputTokens) fail(`${path}.reasoningTokens`, "不能大于 outputTokens");
  return columns;
}

function usageDay(value: unknown, path: string): CodingUsageDay {
  const row = record(value, path);
  const date = siteDate(row.date, `${path}.date`);
  const columns = tokenColumns(row, path);
  const totalTokens = count(row.totalTokens, `${path}.totalTokens`);
  const classified = columns.inputTokens + columns.outputTokens + columns.cacheReadTokens + columns.cacheCreationTokens;
  if (totalTokens < classified) fail(`${path}.totalTokens`, "小于四列之和");
  const apiEquivalentCostUSD = cost(row.apiEquivalentCostUSD, `${path}.apiEquivalentCostUSD`);
  const costComplete = flag(row.costComplete, `${path}.costComplete`);

  const models: CodingUsageDay["models"] = [];
  const seen = new Set<string>();
  let modelTokens = 0;
  list(row.models, `${path}.models`, MAX_DAY_MODELS).forEach((entry, index) => {
    const at = `${path}.models[${index}]`;
    const item = record(entry, at);
    const model = modelName(item.model, `${at}.model`);
    if (seen.has(model)) fail(`${at}.model`, "重复");
    seen.add(model);
    const tokens = count(item.tokens, `${at}.tokens`);
    modelTokens += tokens;
    // 零用量的行不带信息，收下时丢掉；按用量降序，同量按名字
    if (tokens > 0) models.push({ model, tokens });
  });
  if (modelTokens > totalTokens) fail(`${path}.models`, "合计超过 totalTokens");
  models.sort((left, right) => right.tokens - left.tokens || (left.model < right.model ? -1 : 1));

  return { date, ...columns, totalTokens, apiEquivalentCostUSD, costComplete, models };
}

function usageAgent(value: unknown, path: string, receivedAt: number): CodingUsageAgent {
  const row = record(value, path);
  const id = agentId(row.id, `${path}.id`);
  const state = row.state;
  if (state !== "ok" && state !== "error") fail(`${path}.state`, "必须是 ok 或 error");
  const collectedAt = row.collectedAt == null ? null : epochMs(row.collectedAt, `${path}.collectedAt`, receivedAt);
  if (state === "ok" && collectedAt == null) fail(`${path}.collectedAt`, "state 为 ok 时不能缺");
  const agent: CodingUsageAgent = {
    id,
    state,
    collectedAt,
    error: note(row.error, `${path}.error`),
    warning: note(row.warning, `${path}.warning`),
    sessionCount: nullableCount(row.sessionCount, `${path}.sessionCount`),
  };
  if (state === "error") {
    if (row.days != null) fail(`${path}.days`, "state 为 error 时必须缺省：失败的一轮不改历史");
    return agent;
  }
  const dates = new Set<string>();
  agent.days = list(row.days, `${path}.days`, MAX_DAYS)
    .map((entry, index) => {
      const day = usageDay(entry, `${path}.days[${index}]`);
      if (dates.has(day.date)) fail(`${path}.days[${index}].date`, "重复");
      dates.add(day.date);
      return day;
    })
    .sort((left, right) => (left.date < right.date ? -1 : 1));
  return agent;
}

/** `codingUsage`：出现的 agent 整份替换。一封至少一个 agent，id 不重复。 */
export function normalizeCodingUsageReport(input: unknown, receivedAt: number): CodingUsageReport {
  const root = record(input, "");
  const rows = list(root.agents, "agents", MAX_AGENTS);
  if (rows.length === 0) fail("agents", "不能为空");
  const ids = new Set<string>();
  return {
    agents: rows.map((entry, index) => {
      const agent = usageAgent(entry, `agents[${index}]`, receivedAt);
      if (ids.has(agent.id)) fail(`agents[${index}].id`, "重复");
      ids.add(agent.id);
      return agent;
    }),
  };
}

/**
 * `codingActivity`：各 agent 最近一条用量事件。agents 可以是空数组 —— 那封只说「采集器还活着」。
 */
export function normalizeCodingActivityReport(input: unknown, receivedAt: number): CodingActivityReport {
  const root = record(input, "");
  const collectedAt = epochMs(root.collectedAt, "collectedAt", receivedAt);
  const ids = new Set<string>();
  const agents = list(root.agents, "agents", MAX_AGENTS).map((entry, index) => {
    const path = `agents[${index}]`;
    const row = record(entry, path);
    const id = agentId(row.id, `${path}.id`);
    if (ids.has(id)) fail(`${path}.id`, "重复");
    ids.add(id);
    return {
      id,
      lastActivityAt: row.lastActivityAt == null ? null : epochMs(row.lastActivityAt, `${path}.lastActivityAt`, receivedAt),
      model: nullableModel(row.model, `${path}.model`),
    };
  });
  return { collectedAt, agents };
}

/**
 * `codingTokenBuckets`：一段范围内的 5 分钟桶。窗口起点对齐 5 分钟、落在
 * `[floor(from), to)`（首桶可以被范围截断），窗口不重复，同一窗口里 agent × 模型不重复，
 * 行里的 agent 必须在 `agents` 里声明过。
 */
export function normalizeCodingTokenBucketReport(input: unknown, receivedAt: number): CodingTokenBucketReport {
  const root = record(input, "");
  const collectedAt = epochMs(root.collectedAt, "collectedAt", receivedAt);
  const from = count(root.from, "from");
  const to = count(root.to, "to");
  if (to <= from) fail("to", "必须晚于 from");
  if (to > collectedAt) fail("to", "不能晚于 collectedAt");
  if (to - from > MAX_REPORT_SPAN_MS) fail("to", "距 from 超过 25 小时");

  const declared = new Set<string>();
  const agents = list(root.agents, "agents", MAX_AGENTS).map((entry, index): CodingTokenBucketReport["agents"][number] => {
    const path = `agents[${index}]`;
    const row = record(entry, path);
    const id = agentId(row.id, `${path}.id`);
    if (declared.has(id)) fail(`${path}.id`, "重复");
    declared.add(id);
    const state = row.state;
    if (state !== "ok" && state !== "partial" && state !== "unavailable") {
      fail(`${path}.state`, "必须是 ok、partial 或 unavailable");
    }
    return { id, state };
  });

  const first = Math.floor(from / CODING_BUCKET_MS) * CODING_BUCKET_MS;
  const starts = new Set<number>();
  const windows = list(root.windows, "windows", MAX_WINDOWS)
    .map((entry, index) => {
      const path = `windows[${index}]`;
      const row = record(entry, path);
      const start = count(row.from, `${path}.from`);
      if (start % CODING_BUCKET_MS !== 0) fail(`${path}.from`, "必须对齐 5 分钟");
      if (start < first || start >= to) fail(`${path}.from`, "落在报告范围外");
      if (starts.has(start)) fail(`${path}.from`, "重复");
      starts.add(start);
      const keys = new Set<string>();
      const rows = list(row.agents, `${path}.agents`, MAX_WINDOW_ROWS).map((value, rowIndex): CodingTokenBucketRow => {
        const at = `${path}.agents[${rowIndex}]`;
        const bucket = record(value, at);
        const id = agentId(bucket.id, `${at}.id`);
        if (!declared.has(id)) fail(`${at}.id`, "没在 agents 里声明");
        const model = nullableModel(bucket.model, `${at}.model`);
        const key = JSON.stringify([id, model]);
        if (keys.has(key)) fail(at, "同一窗口里 agent 与模型重复");
        keys.add(key);
        return { id, model, ...tokenColumns(bucket, at), eventCount: nullableCount(bucket.eventCount, `${at}.eventCount`) };
      });
      return { from: start, agents: rows };
    })
    .sort((left, right) => left.from - right.from);

  return { from, to, collectedAt, agents, windows };
}
