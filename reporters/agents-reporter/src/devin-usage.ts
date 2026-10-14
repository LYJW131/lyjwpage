import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { type CodingTokenBucketReport, type CodingUsageAgent, type CodingUsageDay, MAX_DAY_MODELS, OVERFLOW_MODEL } from "./coding-usage.js";
import { config } from "./config.js";
import {
  advanceDevinLedger,
  devinBucketReport,
  devinSnapshot,
  type DevinBucketLedger,
  type DevinSnapshot,
  type DevinTokens,
} from "./devin-buckets.js";


export const DEVIN_AGENT_ID = "devin";
// tokens.ci 的客户端名；同一页上的其他客户端由 Mac 与本容器的其他来源负责，这里只取它。
const TOKENS_CI_CLIENT = "devin-cli";
const FETCH_TIMEOUT_MS = 30_000;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class DevinUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DevinUsageError";
  }
}

type ModelRow = { model: string; input: number; output: number; cacheRead: number; cacheWrite: number; reasoning: number; cost: number };

function object(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DevinUsageError(`tokens.ci: ${what} is not an object`);
  return value as Record<string, unknown>;
}

function count(value: unknown, what: string): number {
  if (value == null) return 0;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new DevinUsageError(`tokens.ci: invalid ${what}`);
  return value;
}

function money(value: unknown, what: string): number {
  if (value == null) return 0;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) throw new DevinUsageError(`tokens.ci: invalid ${what}`);
  return value;
}

function add(...values: number[]): number {
  const sum = values.reduce((left, right) => left + right, 0);
  if (!Number.isSafeInteger(sum)) throw new DevinUsageError("tokens.ci: token overflow");
  return sum;
}

function modelRows(client: Record<string, unknown>, date: string): ModelRow[] {
  const models = object(client.models ?? {}, `${date} models`);
  return Object.entries(models).map(([model, raw]) => {
    const row = object(raw, `${date} ${model}`);
    const at = `${date} ${model}`;
    return {
      model,
      input: count(row.input, `${at} input`),
      output: count(row.output, `${at} output`),
      cacheRead: count(row.cacheRead, `${at} cacheRead`),
      cacheWrite: count(row.cacheWrite, `${at} cacheWrite`),
      reasoning: count(row.reasoning, `${at} reasoning`),
      cost: money(row.cost, `${at} cost`),
    };
  });
}

// tokens.ci 的 reasoning 与 output 分列相加（总数 = 五列之和），站点契约里 reasoning 是 output 的子集，所以并进 output。
function usageDay(date: string, rows: ModelRow[]): CodingUsageDay {
  const day: CodingUsageDay = {
    date,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    apiEquivalentCostUSD: 0,
    costComplete: true,
    models: [],
  };
  const models: CodingUsageDay["models"] = [];
  for (const row of rows) {
    const output = add(row.output, row.reasoning);
    const tokens = add(row.input, output, row.cacheRead, row.cacheWrite);
    day.inputTokens = add(day.inputTokens, row.input);
    day.outputTokens = add(day.outputTokens, output);
    day.cacheReadTokens = add(day.cacheReadTokens, row.cacheRead);
    day.cacheCreationTokens = add(day.cacheCreationTokens, row.cacheWrite);
    day.reasoningTokens = add(day.reasoningTokens, row.reasoning);
    day.totalTokens = add(day.totalTokens, tokens);
    day.apiEquivalentCostUSD += row.cost;
    // Devin 自家模型（SWE、compactor、summarizer）没有公开价，tokens.ci 记 0。
    if (tokens > 0 && row.cost === 0) day.costComplete = false;
    if (tokens > 0) models.push({ model: row.model, tokens });
  }
  models.sort((left, right) => right.tokens - left.tokens || (left.model < right.model ? -1 : 1));
  if (models.length > MAX_DAY_MODELS) {
    const kept = models.slice(0, MAX_DAY_MODELS - 1);
    const rest = models.slice(MAX_DAY_MODELS - 1).reduce((sum, row) => add(sum, row.tokens), 0);
    const overflow = kept.find((row) => row.model === OVERFLOW_MODEL);
    if (overflow) overflow.tokens = add(overflow.tokens, rest);
    else kept.push({ model: OVERFLOW_MODEL, tokens: rest });
    day.models = kept;
  } else {
    day.models = models;
  }
  return day;
}

type DevinDay = { date: string; rows: ModelRow[] };

// 只要 devin-cli 第一次出现之后的日子：那之后 tokens.ci 有记录而没有 devin-cli 的一天记全 0（确认没用），之前算未知。
function devinDays(body: unknown): DevinDay[] {
  const root = object(body, "response");
  if (!Array.isArray(root.contributions)) throw new DevinUsageError("tokens.ci: contributions missing");
  const days = root.contributions.map((entry) => {
    const row = object(entry, "contribution");
    if (typeof row.date !== "string" || !DATE.test(row.date)) throw new DevinUsageError("tokens.ci: invalid contribution date");
    const date = row.date;
    const clients = Array.isArray(row.clients) ? row.clients : [];
    const devin = clients.map((client) => object(client, `${date} client`)).filter((client) => client.client === TOKENS_CI_CLIENT);
    return { date, rows: devin.flatMap((client) => modelRows(client, date)), seen: devin.length > 0 };
  });
  days.sort((left, right) => (left.date < right.date ? -1 : left.date > right.date ? 1 : 0));
  const first = days.findIndex((day) => day.seen);
  if (first === -1) return [];
  const merged = new Map<string, ModelRow[]>();
  for (const day of days.slice(first)) merged.set(day.date, [...(merged.get(day.date) ?? []), ...day.rows]);
  return [...merged].map(([date, rows]) => ({ date, rows }));
}

export function devinUsageDays(body: unknown): CodingUsageDay[] {
  return devinDays(body).map((day) => usageDay(day.date, day.rows));
}

function submittedAt(body: unknown): number | null {
  const at = (body as { updatedAt?: unknown } | null)?.updatedAt;
  const parsed = typeof at === "string" ? Date.parse(at) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

export function devinSnapshotOf(body: unknown, now: number): DevinSnapshot {
  const days = devinDays(body).map((day) => {
    const models: Record<string, DevinTokens> = {};
    for (const row of day.rows) {
      const into = models[row.model] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0 };
      into.input = add(into.input, row.input);
      into.output = add(into.output, row.output, row.reasoning);
      into.cacheRead = add(into.cacheRead, row.cacheRead);
      into.cacheWrite = add(into.cacheWrite, row.cacheWrite);
      into.reasoning = add(into.reasoning, row.reasoning);
      models[row.model] = into;
    }
    return { date: day.date, models };
  });
  return devinSnapshot(days, Math.min(submittedAt(body) ?? now, now), now);
}

function statePath(): string {
  return path.join(config.home || "/data", "devin-usage.json");
}

type DevinState = { collectedAt: number | null; buckets: DevinBucketLedger | null };

function ledgerOf(value: unknown): DevinBucketLedger | null {
  const ledger = value as Partial<DevinBucketLedger> | null;
  if (!ledger || typeof ledger.since !== "number" || !Array.isArray(ledger.windows)) return null;
  const snapshot = ledger.snapshot as Partial<DevinSnapshot> | undefined;
  if (!snapshot || typeof snapshot.at !== "number" || !snapshot.days || typeof snapshot.days !== "object") return null;
  return ledger as DevinBucketLedger;
}

// 站点拒收 collectedAt 早于已存账本的行，失败行要带上次成功的时刻才进得去；桶账本要接着上次的快照算增量。两者都跨重启落盘。
async function readState(): Promise<DevinState> {
  try {
    const parsed = JSON.parse(await readFile(statePath(), "utf8")) as { collectedAt?: unknown; buckets?: unknown } | null;
    const at = parsed?.collectedAt;
    return {
      collectedAt: typeof at === "number" && Number.isSafeInteger(at) && at > 0 ? at : null,
      buckets: ledgerOf(parsed?.buckets),
    };
  } catch {
    return { collectedAt: null, buckets: null };
  }
}

async function writeState(state: DevinState): Promise<void> {
  const file = statePath();
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(state), { mode: 0o600 });
  await rename(temporary, file);
}

export async function devinUsageFailure(error: unknown): Promise<CodingUsageAgent> {
  return {
    id: DEVIN_AGENT_ID,
    state: "error",
    collectedAt: (await readState()).collectedAt,
    error: error instanceof Error ? error.message : String(error),
    warning: null,
    sessionCount: null,
  };
}

export async function collectDevinUsage(now = Date.now()): Promise<CodingUsageAgent | null> {
  if (config.limitsFixture || !config.tokensCiUser) return null;
  const url = `https://tokens.ci/api/users/${encodeURIComponent(config.tokensCiUser)}`;
  const response = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new DevinUsageError(`tokens.ci responded ${response.status}`);
  const body: unknown = await response.json();
  const days = devinUsageDays(body);
  const previous = await readState();
  await writeState({ collectedAt: now, buckets: advanceDevinLedger(previous.buckets, devinSnapshotOf(body, now), DEVIN_AGENT_ID, now) });
  return { id: DEVIN_AGENT_ID, state: "ok", collectedAt: now, error: null, warning: null, sessionCount: null, days };
}

export async function devinBucketReportNow(now = Date.now()): Promise<CodingTokenBucketReport | null> {
  if (config.limitsFixture || !config.tokensCiUser) return null;
  const { buckets } = await readState();
  return buckets ? devinBucketReport(buckets, DEVIN_AGENT_ID, now) : null;
}
