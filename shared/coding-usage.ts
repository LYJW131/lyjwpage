import { object } from "@/lib/json";


export type CodingUsageDay = {
  date: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  reasoningTokens: number;
  totalTokens: number;
  apiEquivalentCostUSD: number;
  costComplete: boolean;
  models: Array<{ model: string; tokens: number }>;
};

export type CodingUsageAgent = {
  id: string;
  state: "ok" | "error";
  collectedAt: number | null;
  error: string | null;
  warning: string | null;
  sessionCount: number | null;
  days?: CodingUsageDay[];
};

export type CodingUsageReport = { agents: CodingUsageAgent[] };

export type CodingActivityReport = {
  collectedAt: number;
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
  eventCount: number | null;
};

export type CodingTokenBucketReport = {
  from: number;
  to: number;
  collectedAt: number;
  agents: Array<{ id: string; state: CodingTokenBucketState }>;
  windows: Array<{
    from: number;
    agents: CodingTokenBucketRow[];
  }>;
};

export const CODING_BUCKET_MS = 300_000;
export const CODING_ACTIVE_MS = 5 * 60_000;
export const CODING_ACTIVITY_STALE_MS = 10 * 60_000;

const AGENT_ID = /^[a-z0-9][a-z0-9._-]{0,39}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const FUTURE_SLACK_MS = 60_000;
const MAX_REPORT_SPAN_MS = 25 * 3_600_000;
const MAX_AGENTS = 64;
const MAX_DAYS = 4_000;
const MAX_DAY_MODELS = 64;
const MAX_WINDOWS = 400;
const MAX_WINDOW_ROWS = 64;
const MAX_MODEL_LENGTH = 200;
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
