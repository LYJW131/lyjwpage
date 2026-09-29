import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  bucketStart,
  type CodingActivityReport,
  type CodingTokenBucketReport,
  type CodingTokenBucketRow,
  type CodingTokenBucketWindow,
  type CodingUsageAgent,
  type CodingUsageDay,
} from "./coding-usage.js";
import { config } from "./config.js";
import { estimateCursorCost, modelName, refreshOnlinePrices } from "./cursor-pricing.js";
import { readCursorAccessToken } from "./providers/cursor.js";

/**
 * Cursor 云端用量历史。凭据就是限额那条路已经有的 accessToken。
 * Mac 不在线时云端线程仍在烧 token，所以这份历史改由常驻容器拉。
 *
 * 拉到的事件产出三份事实，都是 Cursor 这个 agent 自己观测到的原始数据（契约见 coding-usage.ts）：
 * 日行账本（codingUsage，整份历史）、最近一条事件（codingActivity）、5 分钟 token 桶
 * （codingTokenBuckets）。合计、排名、「今天」不在这里算，站点合并各来源之后一处算。
 *
 * 事件没有 ID：分页的重叠页按服务端总数对账剔除；云端没再返回的旧日留在账本里。
 * 日桶是 Asia/Shanghai。账本只留聚合，不留 token。
 */

const CURSOR_USAGE_URL = "https://cursor.com/api/dashboard/get-filtered-usage-events";
const PAGE_SIZE = 1_000;
const MAX_PAGES = 1_000;
const PAGE_TIMEOUT_MS = 30_000;
const FETCH_BUDGET_MS = 90_000;
const MAX_PAGE_BYTES = 32 * 1024 * 1024;
const TOKEN_CHARS = /^[A-Za-z0-9._-]+$/;
const IDENTITY_CHARS = /^[A-Za-z0-9_|.-]+$/;

/** 这个来源里 Cursor 的 agent id */
export const CURSOR_AGENT_ID = "cursor";

/** 限额那一轮的桶报告回溯多久：滚动一天（契约上限 25 小时） */
const BUCKET_SPAN_MS = 24 * 3_600_000;

/** 账本里的一天：契约的日行去掉恒为 0 的 reasoning 列（Cursor 事件不分 reasoning），发出去时才补回 */
export type CursorUsageDay = Omit<CodingUsageDay, "reasoningTokens">;

export type UsageEvent = {
  timestampMs: number;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  measured: boolean;
  fingerprint: string;
};

type ParsedPage = { total: number; events: UsageEvent[] };

/**
 * 快循环宽松解析出的一行。它只想知道「最近有没有用、用了多少」，不能因为一条怪事件让活动和桶一起
 * 停更，所以逐行判：时刻落在窗口里就能当活动（模型可缺），token 分列也合规才带 `event`（进桶），
 * 其余的只丢它自己。
 */
export type RecentRow = {
  fingerprint: string;
  at: number | null;
  model: string | null;
  event: UsageEvent | null;
};

type ParsedRecentPage = { total: number; events: RecentRow[] };

type Ledger = {
  version: 1;
  accountHash: string;
  collectedAt: string;
  days: Record<string, CursorUsageDay>;
  /**
   * 上一次全量拉取的时刻和结论。增量那几轮只拉最近两天，判不出「云端还返回哪些旧日」
   * 「历史里有多少请求没 token 数」这类整段历史才有的事，沿用这次的结论。旧账本没有
   * 这几个字段，读到时按「从没全量过」处理，下一轮就会全量拉一次。
   * 费用是否完整按天记在 days 里，不再有整份的结论。
   */
  fullAt?: string;
  fullProblems?: string[];
};

/** 多久全量拉一次，重新核对整段历史（Cursor 迟到的事件、改过的旧事件、新价目）。 */
const FULL_REFRESH_MS = 6 * 3_600_000;

export class CursorUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CursorUsageError";
  }
}

export function shanghaiDay(ms: number): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai" }).format(ms);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => stable(entry)).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    );
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stable(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function integer(value: unknown): number | null {
  if (typeof value === "boolean" || value == null) return null;
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }
  if (typeof value === "string" && /^[0-9]+(?:\.0+)?$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function money(value: unknown): number | null {
  if (value == null) return null;
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed < 0) throw new CursorUsageError("invalid cost");
  return parsed;
}

function add(left: number, right: number): number {
  const sum = left + right;
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || !Number.isSafeInteger(sum) || sum < 0) {
    throw new CursorUsageError("token overflow");
  }
  return sum;
}

/** 从 Cursor JWT 拼出 dashboard 的会话 cookie。不校验签名，只认 sub。 */
export function sessionFromAccessToken(token: string): { accountHash: string; cookie: string } {
  if (!token || token.length > 16_384 || !TOKEN_CHARS.test(token)) {
    throw new CursorUsageError("invalid credentials");
  }
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) throw new CursorUsageError("invalid credentials");
  const padded = parts[1].replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(parts[1].length / 4) * 4, "=");
  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    throw new CursorUsageError("invalid credentials");
  }
  const subject = payload && typeof payload === "object" ? (payload as { sub?: unknown }).sub : null;
  if (typeof subject !== "string" || !subject) throw new CursorUsageError("invalid credentials");
  const pieces = subject.split("|");
  let userId: string | null = null;
  if (pieces.length === 2 && pieces[1]?.startsWith("user_")) userId = pieces[1];
  else if (pieces.length === 2 && ["auth0", "google-oauth2", "github", "oidc"].includes(pieces[0] ?? "")) userId = subject;
  else if (pieces.length === 1 && subject.startsWith("user_")) userId = subject;
  if (!userId || !IDENTITY_CHARS.test(userId)) throw new CursorUsageError("invalid credentials");
  return {
    accountHash: sha256(`cursor-account:${userId}`),
    cookie: `WorkosCursorSessionToken=${userId}%3A%3A${token}`,
  };
}

/** 一条事件的严格解析：时刻或模型不对、token 分列缺项或不合规都抛 */
function readEvent(value: unknown, lower: number, upper: number): UsageEvent {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const timestamp = row ? integer(row.timestamp) : null;
  const model = row && typeof row.model === "string" ? row.model.trim() : "";
  if (!row || timestamp == null || timestamp <= 0 || timestamp < lower || timestamp > upper || !model) {
    throw new CursorUsageError("event timestamp or model");
  }
  let tokenUsage: Record<string, unknown> = {};
  let measured = false;
  if (row.tokenUsage != null) {
    if (typeof row.tokenUsage !== "object") throw new CursorUsageError("token usage");
    tokenUsage = row.tokenUsage as Record<string, unknown>;
    measured = true;
  } else if (row.isTokenBasedCall !== false) {
    throw new CursorUsageError("missing token usage");
  }
  const counts = ["inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens"].map((key) => {
    if (tokenUsage[key] == null) return 0;
    const count = integer(tokenUsage[key]);
    if (count == null) throw new CursorUsageError("invalid token count");
    return count;
  });
  counts.reduce((sum, count) => add(sum, count), 0);
  money(tokenUsage.totalCents);
  money(row.chargedCents);
  return {
    timestampMs: timestamp,
    model,
    inputTokens: counts[0] ?? 0,
    outputTokens: counts[1] ?? 0,
    cacheReadTokens: counts[2] ?? 0,
    cacheCreationTokens: counts[3] ?? 0,
    measured,
    fingerprint: sha256(stable(row)),
  };
}

/** 拉历史用：整页严格，一条事件不合规整页判坏 */
export function parseUsagePage(body: unknown, lower: number, upper: number): ParsedPage {
  const root = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  const rows = root?.usageEventsDisplay;
  const total = integer(root?.totalUsageEventsCount);
  if (!root || !Array.isArray(rows) || total == null) {
    throw new CursorUsageError("missing event array or total count");
  }
  return { total, events: rows.map((value) => readEvent(value, lower, upper)) };
}

/**
 * 快循环用：页的结构仍要对，逐行宽松。不合规的行留在 `events` 里（分页对账要数它，指纹照算），
 * 只是不带 `event`，进不了桶；时刻还认得的照样算活动。
 */
export function parseRecentPage(body: unknown, lower: number, upper: number): ParsedRecentPage {
  const root = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  if (!root) throw new CursorUsageError("Cursor usage events missing");
  // 窗口里一条都没有时 Cursor 连这个字段都省掉（protobuf 的空数组不出现在 JSON 里）
  const rows = root.usageEventsDisplay ?? [];
  if (!Array.isArray(rows)) throw new CursorUsageError("Cursor usage events malformed");
  // 总数缺省只在一页装得下时认：这一页就是全部
  const total = integer(root.totalUsageEventsCount) ?? (rows.length < PAGE_SIZE ? rows.length : null);
  if (total == null) throw new CursorUsageError("missing event total count");
  return { total, events: rows.map((value) => readRecentRow(value, lower, upper)) };
}

function readRecentRow(value: unknown, lower: number, upper: number): RecentRow {
  const row = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const timestamp = row ? integer(row.timestamp) : null;
  const raw = row && typeof row.model === "string" ? row.model.trim() : "";
  let event: UsageEvent | null = null;
  try {
    event = readEvent(value, lower, upper);
  } catch (error) {
    if (!(error instanceof CursorUsageError)) throw error;
  }
  return {
    fingerprint: sha256(stable(value)),
    at: timestamp != null && timestamp > 0 && timestamp >= lower && timestamp <= upper ? timestamp : null,
    model: raw ? modelName(raw) : null,
    event,
  };
}

/** 没有事件 ID。只删掉服务端总数证明是重复的相邻页重叠。 */
export function reconcilePages<T extends { fingerprint: string }>(pages: T[][], expected: number): T[] {
  const rawCount = pages.reduce((sum, page) => sum + page.length, 0);
  if (rawCount < expected) throw new CursorUsageError("incomplete pagination");
  let remaining = rawCount - expected;
  const output = [...(pages[0] ?? [])];
  for (let index = 1; index < pages.length; index += 1) {
    const previous = pages[index - 1] ?? [];
    const current = pages[index] ?? [];
    const bound = Math.min(previous.length, current.length);
    let overlap = 0;
    for (let length = bound; length >= 1; length -= 1) {
      const same = previous.slice(-length).every((event, offset) => event.fingerprint === current[offset]?.fingerprint);
      if (same) {
        overlap = length;
        break;
      }
    }
    const removed = Math.min(remaining, overlap);
    remaining -= removed;
    output.push(...current.slice(removed));
  }
  if (remaining !== 0 || output.length !== expected) throw new CursorUsageError("inconsistent pagination");
  return output;
}

function emptyDay(date: string): CursorUsageDay {
  return {
    date,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    totalTokens: 0,
    apiEquivalentCostUSD: 0,
    costComplete: true,
    models: [],
  };
}

/** 事件按站点日收成账本的日行；费用是否完整按天记（`costComplete`），当天没有事件也补一行空的 */
export function aggregateEvents(events: UsageEvent[], collectedAtMs: number): {
  days: CursorUsageDay[];
  unmeasured: number;
} {
  const days = new Map<string, CursorUsageDay>();
  const modelTokens = new Map<string, Map<string, number>>();
  let unmeasured = 0;
  for (const event of events) {
    const date = shanghaiDay(event.timestampMs);
    const row = days.get(date) ?? emptyDay(date);
    row.inputTokens = add(row.inputTokens, event.inputTokens);
    row.outputTokens = add(row.outputTokens, event.outputTokens);
    row.cacheReadTokens = add(row.cacheReadTokens, event.cacheReadTokens);
    row.cacheCreationTokens = add(row.cacheCreationTokens, event.cacheCreationTokens);
    const total = event.inputTokens + event.outputTokens + event.cacheReadTokens + event.cacheCreationTokens;
    row.totalTokens = add(row.totalTokens, total);
    if (!event.measured) {
      unmeasured += 1;
      row.costComplete = false;
    } else {
      const cost = estimateCursorCost(
        event.model,
        event.inputTokens,
        event.outputTokens,
        event.cacheReadTokens,
        event.cacheCreationTokens,
        event.timestampMs,
      );
      if (cost == null) {
        row.costComplete = false;
      } else {
        row.apiEquivalentCostUSD += cost;
      }
    }
    if (total > 0) {
      const name = modelName(event.model);
      const models = modelTokens.get(date) ?? new Map<string, number>();
      models.set(name, add(models.get(name) ?? 0, total));
      modelTokens.set(date, models);
    }
    days.set(date, row);
  }
  const today = shanghaiDay(collectedAtMs);
  if (!days.has(today)) days.set(today, emptyDay(today));
  for (const [date, row] of days) {
    const models = modelTokens.get(date);
    row.models = [...(models ?? new Map<string, number>())]
      .filter(([, tokens]) => tokens > 0)
      .map(([model, tokens]) => ({ model, tokens }))
      .sort((left, right) => right.tokens - left.tokens || (left.model < right.model ? -1 : 1))
      .slice(0, 40);
  }
  return {
    days: [...days.values()].sort((left, right) => (left.date < right.date ? -1 : 1)),
    unmeasured,
  };
}

function ledgerPath(): string {
  return path.join(config.home || "/data", "cursor-usage.json");
}

async function readLedger(): Promise<Ledger | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(ledgerPath(), "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    const row = parsed as Partial<Ledger>;
    if (row.version !== 1 || typeof row.accountHash !== "string" || !row.days || typeof row.days !== "object") return null;
    return {
      version: 1,
      accountHash: row.accountHash,
      collectedAt: typeof row.collectedAt === "string" ? row.collectedAt : "",
      days: row.days,
      ...(typeof row.fullAt === "string" ? { fullAt: row.fullAt } : {}),
      ...(Array.isArray(row.fullProblems) && row.fullProblems.every((item) => typeof item === "string")
        ? { fullProblems: row.fullProblems }
        : {}),
    };
  } catch {
    return null;
  }
}

async function writeLedger(ledger: Ledger): Promise<void> {
  const file = ledgerPath();
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(ledger), { mode: 0o600 });
  await rename(temporary, file);
}

/**
 * 这次拉到的日子覆盖旧值，没再出现的旧活动日留着。
 * 云端保留窗口变短时不能把账本清掉。
 */
export function applyLedger(
  previous: Ledger | null,
  accountHash: string,
  incoming: CursorUsageDay[],
  collectedAt: string,
  unmeasured: number,
): { ledger: Ledger; usage: CodingUsageAgent } {
  const fresh = previous?.accountHash === accountHash ? { ...previous.days } : {};
  const problems: string[] = [];
  if (unmeasured > 0) problems.push(`${unmeasured} historical requests had no token counts`);
  const incomingDates = new Set(incoming.map((day) => day.date));
  const previousDates = Object.values(fresh)
    .filter((day) => day.totalTokens > 0)
    .map((day) => day.date)
    .sort();
  const incomingNonzero = incoming.filter((day) => day.totalTokens > 0).map((day) => day.date);
  const incomingStart = incomingNonzero[0] ?? null;
  const incomingEnd = incomingNonzero.at(-1) ?? null;
  if (previousDates[0] && (!incomingStart || incomingStart > previousDates[0])) {
    problems.push("History start moved forward; kept older days");
  }
  if (previousDates.at(-1) && (!incomingEnd || incomingEnd < previousDates.at(-1)!)) {
    problems.push("History end moved backward; kept newer days");
  }
  const missing = previousDates.filter((date) => !incomingDates.has(date));
  if (missing.length > 0) problems.push(`Kept ${missing.length} active days the cloud no longer returns`);
  for (const day of incoming) fresh[day.date] = day;
  const ledger: Ledger = {
    version: 1,
    accountHash,
    collectedAt,
    days: fresh,
    fullAt: collectedAt,
    fullProblems: problems,
  };
  return { ledger, usage: usageFrom(ledger, problems) };
}

/**
 * 增量那一轮：只拉了最近两天，这两天整天替换，其余日子原样留着。整段历史的结论
 * （问题）沿用上次全量的。
 */
export function applyIncrementalLedger(
  previous: Ledger,
  incoming: CursorUsageDay[],
  collectedAt: string,
): { ledger: Ledger; usage: CodingUsageAgent } {
  const days = { ...previous.days };
  for (const day of incoming) days[day.date] = day;
  const ledger: Ledger = { ...previous, collectedAt, days };
  return { ledger, usage: usageFrom(ledger, previous.fullProblems ?? []) };
}

/** 账本的日子 → 契约的日行：补回 reasoning 列（Cursor 不分，恒为 0），只带契约里有的字段 */
function wireDay(day: CursorUsageDay): CodingUsageDay {
  return {
    date: day.date,
    inputTokens: day.inputTokens,
    outputTokens: day.outputTokens,
    cacheReadTokens: day.cacheReadTokens,
    cacheCreationTokens: day.cacheCreationTokens,
    reasoningTokens: 0,
    totalTokens: day.totalTokens,
    apiEquivalentCostUSD: day.apiEquivalentCostUSD,
    costComplete: day.costComplete,
    models: day.models,
  };
}

/**
 * 账本整份发：全部日子，整份替换站点里 (agents, cursor) 那份。拉到了但有缺口（部分请求没有
 * token 数、云端历史变短）时仍是 ok，缺口写进 warning。
 */
function usageFrom(ledger: Ledger, problems: string[]): CodingUsageAgent {
  return {
    id: CURSOR_AGENT_ID,
    state: "ok",
    collectedAt: Date.parse(ledger.collectedAt),
    error: null,
    warning: problems.length > 0 ? problems.join("; ") : null,
    sessionCount: null,
    days: Object.values(ledger.days)
      .sort((left, right) => (left.date < right.date ? -1 : 1))
      .map(wireDay),
  };
}

/**
 * 这一轮拉失败：只换状态，不带 days，站点不动历史。`collectedAt` 是账本里最近一次成功的时刻，
 * 没有账本（从没成功过）就是 null。
 */
export function failedUsage(error: unknown, lastCollectedAt: string | null): CodingUsageAgent {
  const at = lastCollectedAt ? Date.parse(lastCollectedAt) : Number.NaN;
  return {
    id: CURSOR_AGENT_ID,
    state: "error",
    collectedAt: Number.isFinite(at) ? at : null,
    error: error instanceof Error ? error.message : String(error),
    warning: null,
    sessionCount: null,
  };
}

export async function cursorUsageFailure(error: unknown): Promise<CodingUsageAgent> {
  return failedUsage(error, (await readLedger())?.collectedAt ?? null);
}

/** 上海时间「昨天」0 点。增量从这里拉，跨午夜那几分钟和迟到的事件都盖得住。 */
export function incrementalSince(now: number): number {
  return Date.parse(`${shanghaiDay(now - 86_400_000)}T00:00:00+08:00`);
}

function needsFullRefresh(ledger: Ledger | null, accountHash: string, now: number): boolean {
  if (!ledger || ledger.accountHash !== accountHash || !ledger.fullAt) return true;
  const fullAt = Date.parse(ledger.fullAt);
  return !Number.isFinite(fullAt) || now - fullAt >= FULL_REFRESH_MS || now < fullAt;
}

/** 一批事件里最新的一条：时刻和模型。同一时刻先到的赢。活动灯用，见 cursor-now.ts。 */
export type LatestEvent = { at: number; model: string | null };

export function latestOf(rows: Iterable<{ at: number | null; model: string | null }>): LatestEvent | null {
  let latest: LatestEvent | null = null;
  for (const row of rows) {
    if (row.at != null && (!latest || row.at > latest.at)) latest = { at: row.at, model: row.model };
  }
  return latest;
}

/**
 * `codingActivity`：Cursor 最近一条用量事件。没见过事件（`latest` 为空）就是 null，行照发 ——
 * 「采集了、没看到」和「没采集」是两回事。时刻不晚于采集时刻：Cursor 和容器的钟对不齐时，
 * 一条「未来」的事件不能让整份活动被站点当成时刻不合法而拒收。
 */
export function cursorActivityReport(collectedAt: number, latest: LatestEvent | null): CodingActivityReport {
  return {
    collectedAt,
    agents: [
      {
        id: CURSOR_AGENT_ID,
        lastActivityAt: latest ? Math.min(latest.at, collectedAt) : null,
        model: latest?.model ?? null,
      },
    ],
  };
}

/**
 * 事件按 `timestampMs` 落 5 分钟桶（CODING_BUCKET_MS），只收 [from, to) 内的。同一桶里按模型分行，
 * `eventCount` 是这一行的事件数：没有 token 分列的事件（不按 token 计费的请求）也算一条，token 记 0。
 * 按桶起点升序，桶内按模型名；空桶不出。
 */
export function aggregateBuckets(events: UsageEvent[], from: number, to: number): CodingTokenBucketWindow[] {
  const windows = new Map<number, Map<string, CodingTokenBucketRow & { eventCount: number }>>();
  for (const event of events) {
    if (event.timestampMs < from || event.timestampMs >= to) continue;
    const start = bucketStart(event.timestampMs);
    const model = modelName(event.model);
    const rows = windows.get(start) ?? new Map();
    const row =
      rows.get(model) ??
      {
        id: CURSOR_AGENT_ID,
        model,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        reasoningTokens: 0,
        eventCount: 0,
      };
    row.inputTokens = add(row.inputTokens, event.inputTokens);
    row.outputTokens = add(row.outputTokens, event.outputTokens);
    row.cacheReadTokens = add(row.cacheReadTokens, event.cacheReadTokens);
    row.cacheCreationTokens = add(row.cacheCreationTokens, event.cacheCreationTokens);
    row.eventCount += 1;
    rows.set(model, row);
    windows.set(start, rows);
  }
  return [...windows]
    .sort(([left], [right]) => left - right)
    .map(([start, rows]) => ({
      from: start,
      agents: [...rows.values()].sort((left, right) => ((left.model ?? "") < (right.model ?? "") ? -1 : 1)),
    }));
}

/**
 * `codingTokenBuckets`：[from, to) 内以这封为准，缺席的桶 = 0。`partial` = 这一批里有解析不了、
 * 只能丢掉的事件，桶可能偏少。调用方把 `from` 对齐到桶边界，首桶才是完整的，不会被范围截断。
 */
export function cursorBucketReport(
  events: UsageEvent[],
  range: { from: number; to: number },
  collectedAt: number,
  partial = false,
): CodingTokenBucketReport {
  return {
    from: range.from,
    to: range.to,
    collectedAt,
    agents: [{ id: CURSOR_AGENT_ID, state: partial ? "partial" : "ok" }],
    windows: aggregateBuckets(events, range.from, range.to),
  };
}

type FetchResult = { status: number; body: unknown; location: string | null };
type PageFetch = typeof fetch;

export async function postPage(
  cookie: string,
  page: number,
  lower: number,
  upper: number,
  fetchPage: PageFetch = fetch,
  pageSize = PAGE_SIZE,
): Promise<FetchResult> {
  let url = CURSOR_USAGE_URL;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetchPage(url, {
      method: "POST",
      redirect: "manual",
      headers: {
        Cookie: cookie,
        "Content-Type": "application/json",
        Accept: "application/json",
        Origin: new URL(url).origin,
      },
      body: JSON.stringify({ page, pageSize, startDate: String(lower), endDate: String(upper) }),
      signal: AbortSignal.timeout(PAGE_TIMEOUT_MS),
    });
    if (response.status === 401 || response.status === 403) throw new CursorUsageError("Cursor session expired");
    if ([301, 302, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      const target = location ? new URL(location, url) : null;
      if (
        attempt !== 0 ||
        !target ||
        target.protocol !== "https:" ||
        (target.hostname !== "cursor.com" && target.hostname !== "www.cursor.com") ||
        (target.port !== "" && target.port !== "443") ||
        target.username ||
        target.password
      ) {
        throw new CursorUsageError("unsafe redirect");
      }
      url = target.toString();
      continue;
    }
    if (response.status !== 200) throw new CursorUsageError(`Cursor history returned HTTP ${response.status}`);
    const text = await response.text();
    if (text.length > MAX_PAGE_BYTES) throw new CursorUsageError("response too large");
    try {
      return { status: response.status, body: JSON.parse(text) as unknown, location: null };
    } catch {
      throw new CursorUsageError("invalid response");
    }
  }
  throw new CursorUsageError("unsafe redirect");
}

/**
 * 分页取一段时间内的全部事件，重叠页按服务端总数对账。拉历史和快循环共用，区别只在 `parse`：
 * 一个整页严格、一个逐行宽松（返回的行数要和服务端总数对得上，宽松也得把丢掉的行数进去）。
 */
async function fetchPages<T extends { fingerprint: string }>(
  cookie: string,
  lower: number,
  upper: number,
  parse: (body: unknown) => { total: number; events: T[] },
  fetchPage?: PageFetch,
): Promise<T[]> {
  const pages: T[][] = [];
  const seen = new Set<string>();
  let expected: number | null = null;
  let complete = false;
  const deadline = Date.now() + FETCH_BUDGET_MS;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    if (Date.now() > deadline) throw new CursorUsageError("history fetch exceeded time budget");
    const response = await postPage(cookie, page, lower, upper, fetchPage);
    const parsed = parse(response.body);
    if (expected != null && expected !== parsed.total) throw new CursorUsageError("inconsistent pagination");
    expected = parsed.total;
    if (parsed.events.length > PAGE_SIZE) throw new CursorUsageError("inconsistent pagination");
    if (parsed.events.length > 0) {
      const signature = sha256(parsed.events.map((event) => event.fingerprint).join(":"));
      if (seen.has(signature)) throw new CursorUsageError("inconsistent pagination");
      seen.add(signature);
      pages.push(parsed.events);
    }
    if (parsed.events.length < PAGE_SIZE) {
      complete = true;
      break;
    }
  }
  if (!complete || expected == null) throw new CursorUsageError("incomplete pagination");
  return reconcilePages(pages, expected);
}

export async function fetchCursorHistory(
  cookie: string,
  untilMs: number,
  fetchPage?: PageFetch,
  sinceMs = 0,
): Promise<UsageEvent[]> {
  const lower = sinceMs;
  const upper = untilMs;
  if (!Number.isSafeInteger(upper) || upper < lower) throw new CursorUsageError("invalid date range");
  return fetchPages(cookie, lower, upper, (body) => parseUsagePage(body, lower, upper), fetchPage);
}

/** 快循环取最近一段的全部行：分页和对账同 fetchCursorHistory，逐行宽松解析（见 parseRecentPage） */
export async function fetchRecentRows(
  cookie: string,
  lower: number,
  upper: number,
  fetchPage?: PageFetch,
): Promise<RecentRow[]> {
  if (!Number.isSafeInteger(lower) || !Number.isSafeInteger(upper) || upper < lower) {
    throw new CursorUsageError("invalid date range");
  }
  return fetchPages(cookie, lower, upper, (body) => parseRecentPage(body, lower, upper), fetchPage);
}

/** 限额那一轮拉出来的三份事实，加上最近一条事件的时刻（拿它叫醒快循环） */
export type CursorCollected = {
  usage: CodingUsageAgent;
  activity: CodingActivityReport;
  buckets: CodingTokenBucketReport;
  latestAt: number | null;
};

/**
 * 拉 Cursor 用量、并进本地账本。没配凭据返回 null。失败不改账本。
 *
 * 平时只拉上海时间昨天 0 点以来的事件，账本里其余日子原样留着；6 小时、换账号、或账本
 * 还没全量过时整段历史重拉一次核对。同一批事件顺手落 5 分钟桶（范围是滚动一天，起点对齐到桶边界）
 * 并取最新一条给活动灯用。
 */
export async function collectCursorUsage(now = Date.now()): Promise<CursorCollected | null> {
  if (config.limitsFixture) return null;
  const accessToken = await readCursorAccessToken();
  if (!accessToken) return null;
  const session = sessionFromAccessToken(accessToken);
  const previous = await readLedger();
  const full = needsFullRefresh(previous, session.accountHash, now);
  const since = full ? 0 : incrementalSince(now);
  const [events] = await Promise.all([
    fetchCursorHistory(session.cookie, now, undefined, since),
    refreshOnlinePrices(now),
  ]);
  const aggregated = aggregateEvents(events, now);
  const collectedAt = new Date(now).toISOString();
  let applied: { ledger: Ledger; usage: CodingUsageAgent };
  if (full || !previous) {
    applied = applyLedger(previous, session.accountHash, aggregated.days, collectedAt, aggregated.unmeasured);
  } else {
    // 窗口里没事件的那天也要写成 0：这两天是这次拉全了的，不是没拉到
    const yesterday = shanghaiDay(now - 86_400_000);
    const days = aggregated.days.some((day) => day.date === yesterday)
      ? aggregated.days
      : [emptyDay(yesterday), ...aggregated.days];
    applied = applyIncrementalLedger(previous, days, collectedAt);
  }
  await writeLedger(applied.ledger);
  const latest = latestOf(events.map((event) => ({ at: event.timestampMs, model: modelName(event.model) })));
  // 起点向下对齐到桶边界：事件是从 since 起整段拉全的，首桶因此是完整的；since 本身落在桶边界上
  const from = Math.max(since, bucketStart(now - BUCKET_SPAN_MS));
  return {
    usage: applied.usage,
    activity: cursorActivityReport(now, latest),
    buckets: cursorBucketReport(events, { from, to: now }, now),
    latestAt: latest?.at ?? null,
  };
}
