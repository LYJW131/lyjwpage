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
  MAX_DAY_MODELS,
  MAX_WINDOW_ROWS,
  OVERFLOW_MODEL,
} from "./coding-usage.js";
import { config } from "./config.js";
import { estimateCursorCost, modelName, refreshOnlinePrices } from "./cursor-pricing.js";
import { readCursorAccessToken } from "./providers/cursor.js";


const CURSOR_USAGE_URL = "https://cursor.com/api/dashboard/get-filtered-usage-events";
const PAGE_SIZE = 1_000;
const MAX_PAGES = 1_000;
const PAGE_TIMEOUT_MS = 30_000;
const FETCH_BUDGET_MS = 90_000;
const MAX_PAGE_BYTES = 32 * 1024 * 1024;
const TOKEN_CHARS = /^[A-Za-z0-9._-]+$/;
const IDENTITY_CHARS = /^[A-Za-z0-9_|.-]+$/;

export const CURSOR_AGENT_ID = "cursor";

const BUCKET_SPAN_MS = 24 * 3_600_000;

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
  fullAt?: string;
  fullProblems?: string[];
};

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

function foldOverflow<T extends { model: string | null }>(
  rows: T[],
  max: number,
  strongestFirst: (left: T, right: T) => number,
  blank: (model: string) => T,
  absorb: (into: T, row: T) => void,
): T[] {
  if (rows.length <= max) return rows;
  const ordered = [...rows].sort(strongestFirst);
  const kept = ordered.slice(0, max - 1);
  let overflow = kept.find((row) => row.model === OVERFLOW_MODEL);
  if (!overflow) {
    overflow = blank(OVERFLOW_MODEL);
    kept.push(overflow);
  }
  for (const row of ordered.slice(max - 1)) absorb(overflow, row);
  return kept;
}

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

export function parseUsagePage(body: unknown, lower: number, upper: number): ParsedPage {
  const root = body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  // Cursor 的零值响应会省略空事件数组和总数；只认空对象或显式空数组，不能把错误对象当成零用量。
  const emptyResponse = root != null && Object.keys(root).every((key) => key === "usageEventsDisplay") &&
    (root.usageEventsDisplay === undefined || (Array.isArray(root.usageEventsDisplay) && root.usageEventsDisplay.length === 0));
  const total = emptyResponse ? 0 : integer(root?.totalUsageEventsCount);
  const rows = root?.usageEventsDisplay === undefined && total != null ? [] : root?.usageEventsDisplay;
  if (!root || !Array.isArray(rows) || total == null) {
    throw new CursorUsageError("missing event array or total count");
  }
  return { total, events: rows.map((value) => readEvent(value, lower, upper)) };
}

// 解析失败的行也必须保留指纹并参与分页计数，否则对账会误判为缺页。
export function parseRecentPage(body: unknown, lower: number, upper: number): ParsedRecentPage {
  const root = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  if (!root) throw new CursorUsageError("Cursor usage events missing");
  // 窗口里一条都没有时 Cursor 连这个字段都省掉（protobuf 的空数组不出现在 JSON 里）
  const rows = root.usageEventsDisplay ?? [];
  if (!Array.isArray(rows)) throw new CursorUsageError("Cursor usage events malformed");
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

// 事件没有 ID，相同内容可能是不同请求；只能删除服务端总数证实的跨页重叠。
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

type DayModel = CursorUsageDay["models"][number];

function byTokens(left: DayModel, right: DayModel): number {
  return right.tokens - left.tokens || (left.model < right.model ? -1 : 1);
}

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
    const models = [...(modelTokens.get(date) ?? new Map<string, number>())]
      .filter(([, tokens]) => tokens > 0)
      .map(([model, tokens]): DayModel => ({ model, tokens }));
    row.models = foldOverflow(
      models,
      MAX_DAY_MODELS,
      byTokens,
      (model) => ({ model, tokens: 0 }),
      (into, from) => {
        into.tokens = add(into.tokens, from.tokens);
      },
    ).sort(byTokens);
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

// 云端历史窗口可能缩短；缺席的旧日不能从本地账本删除。
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

export function incrementalSince(now: number): number {
  return Date.parse(`${shanghaiDay(now - 86_400_000)}T00:00:00+08:00`);
}

function needsFullRefresh(ledger: Ledger | null, accountHash: string, now: number): boolean {
  if (!ledger || ledger.accountHash !== accountHash || !ledger.fullAt) return true;
  const fullAt = Date.parse(ledger.fullAt);
  return !Number.isFinite(fullAt) || now - fullAt >= FULL_REFRESH_MS || now < fullAt;
}

export type LatestEvent = { at: number; model: string | null };

export function latestOf(rows: Iterable<{ at: number | null; model: string | null }>): LatestEvent | null {
  let latest: LatestEvent | null = null;
  for (const row of rows) {
    if (row.at != null && (!latest || row.at > latest.at)) latest = { at: row.at, model: row.model };
  }
  return latest;
}

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

type BucketRow = CodingTokenBucketRow & { eventCount: number };

function blankBucketRow(model: string): BucketRow {
  return {
    id: CURSOR_AGENT_ID,
    model,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    reasoningTokens: 0,
    eventCount: 0,
  };
}

function absorbBucketRow(into: BucketRow, row: BucketRow): void {
  into.inputTokens = add(into.inputTokens, row.inputTokens);
  into.outputTokens = add(into.outputTokens, row.outputTokens);
  into.cacheReadTokens = add(into.cacheReadTokens, row.cacheReadTokens);
  into.cacheCreationTokens = add(into.cacheCreationTokens, row.cacheCreationTokens);
  into.reasoningTokens = add(into.reasoningTokens, row.reasoningTokens);
  into.eventCount = add(into.eventCount, row.eventCount);
}

function bucketTokens(row: BucketRow): number {
  return row.inputTokens + row.outputTokens + row.cacheReadTokens + row.cacheCreationTokens;
}

function heaviestBucketRow(left: BucketRow, right: BucketRow): number {
  return bucketTokens(right) - bucketTokens(left) || right.eventCount - left.eventCount || byModelName(left, right);
}

function byModelName(left: BucketRow, right: BucketRow): number {
  return (left.model ?? "") < (right.model ?? "") ? -1 : 1;
}

export function aggregateBuckets(events: UsageEvent[], from: number, to: number): CodingTokenBucketWindow[] {
  const windows = new Map<number, Map<string, BucketRow>>();
  for (const event of events) {
    if (event.timestampMs < from || event.timestampMs >= to) continue;
    const start = bucketStart(event.timestampMs);
    const model = modelName(event.model);
    const rows = windows.get(start) ?? new Map<string, BucketRow>();
    const row = rows.get(model) ?? blankBucketRow(model);
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
      agents: foldOverflow([...rows.values()], MAX_WINDOW_ROWS, heaviestBucketRow, blankBucketRow, absorbBucketRow).sort(byModelName),
    }));
}

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

export type CursorCollected = {
  usage: CodingUsageAgent;
  activity: CodingActivityReport;
  buckets: CodingTokenBucketReport;
  latestAt: number | null;
};

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
    const yesterday = shanghaiDay(now - 86_400_000);
    const days = aggregated.days.some((day) => day.date === yesterday)
      ? aggregated.days
      : [emptyDay(yesterday), ...aggregated.days];
    applied = applyIncrementalLedger(previous, days, collectedAt);
  }
  await writeLedger(applied.ledger);
  const latest = latestOf(events.map((event) => ({ at: event.timestampMs, model: modelName(event.model) })));
  const from = Math.max(since, bucketStart(now - BUCKET_SPAN_MS));
  return {
    usage: applied.usage,
    activity: cursorActivityReport(now, latest),
    buckets: cursorBucketReport(events, { from, to: now }, now),
    latestAt: latest?.at ?? null,
  };
}
