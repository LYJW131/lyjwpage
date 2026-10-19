import { createHash } from "node:crypto";

import { modelName } from "./cursor-pricing.js";

const CURSOR_USAGE_URL = "https://cursor.com/api/dashboard/get-filtered-usage-events";
const PAGE_SIZE = 1_000;
const MAX_PAGES = 1_000;
const PAGE_TIMEOUT_MS = 30_000;
const FETCH_BUDGET_MS = 90_000;
const MAX_PAGE_BYTES = 32 * 1024 * 1024;
const TOKEN_CHARS = /^[A-Za-z0-9._-]+$/;
const IDENTITY_CHARS = /^[A-Za-z0-9_|.-]+$/;

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

export class CursorUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CursorUsageError";
  }
}

export function sha256(value: string): string {
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

export function integer(value: unknown): number | null {
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

export function add(left: number, right: number): number {
  const sum = left + right;
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right) || !Number.isSafeInteger(sum) || sum < 0) {
    throw new CursorUsageError("token overflow");
  }
  return sum;
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
