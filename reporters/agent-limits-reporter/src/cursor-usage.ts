import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { config } from "./config.js";
import { estimateCursorCost, modelName } from "./cursor-pricing.js";
import { readCursorAccessToken } from "./providers/cursor.js";

/**
 * Cursor 云端用量历史。凭据就是限额那条路已经有的 accessToken。
 * Mac 不在线时云端线程仍在烧 token，所以这份历史改由常驻容器拉。
 *
 * 分页、重叠页剔除和「云端没再返回的旧日留着」跟 MacTelemetryHub 的
 * CursorUsage 同一套。日桶是 Asia/Shanghai。账本只留聚合，不留 token。
 */

const CURSOR_USAGE_URL = "https://cursor.com/api/dashboard/get-filtered-usage-events";
const PAGE_SIZE = 1_000;
const MAX_PAGES = 1_000;
const PAGE_TIMEOUT_MS = 30_000;
const FETCH_BUDGET_MS = 90_000;
const MAX_PAGE_BYTES = 32 * 1024 * 1024;
const TOKEN_CHARS = /^[A-Za-z0-9._-]+$/;
const IDENTITY_CHARS = /^[A-Za-z0-9_|.-]+$/;

export type CursorUsageDay = {
  date: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  apiEquivalentCostUSD: number;
  costComplete: boolean;
  models: Array<{ model: string; tokens: number }>;
};

export type CursorUsagePush = {
  collectedAt: string;
  state: "ok" | "error";
  error: string | null;
  coverageStart: string | null;
  coverageEnd: string | null;
  precision: "measured";
  costComplete: boolean;
  days: CursorUsageDay[];
};

type UsageEvent = {
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

type Ledger = {
  version: 1;
  accountHash: string;
  collectedAt: string;
  days: Record<string, CursorUsageDay>;
};

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

/** 从 Cursor JWT 拼出和 Mac 同一份会话 cookie。不校验签名，只认 sub。 */
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

export function parseUsagePage(body: unknown, lower: number, upper: number): ParsedPage {
  const root = body && typeof body === "object" ? (body as Record<string, unknown>) : null;
  const rows = root?.usageEventsDisplay;
  const total = integer(root?.totalUsageEventsCount);
  if (!root || !Array.isArray(rows) || total == null) {
    throw new CursorUsageError("missing event array or total count");
  }
  const events = rows.map((value) => {
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
  });
  return { total, events };
}

/** 没有事件 ID。只删掉服务端总数证明是重复的相邻页重叠。 */
export function reconcilePages(pages: UsageEvent[][], expected: number): UsageEvent[] {
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

export function aggregateEvents(events: UsageEvent[], collectedAtMs: number): {
  days: CursorUsageDay[];
  costComplete: boolean;
  unmeasured: number;
} {
  const days = new Map<string, CursorUsageDay>();
  const modelTokens = new Map<string, Map<string, number>>();
  let costComplete = true;
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
      costComplete = false;
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
        costComplete = false;
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
    costComplete,
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
 * 云端保留窗口变短时不能把账本清掉，和 Mac 那本账同一条。
 */
export function applyLedger(
  previous: Ledger | null,
  accountHash: string,
  incoming: CursorUsageDay[],
  collectedAt: string,
  costComplete: boolean,
  unmeasured: number,
): { ledger: Ledger; push: CursorUsagePush } {
  const collectedAtMs = Date.parse(collectedAt);
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
  const ledger: Ledger = { version: 1, accountHash, collectedAt, days: fresh };
  const days = Object.values(fresh).sort((left, right) => (left.date < right.date ? -1 : 1));
  const coverageStart = days.find((day) => day.totalTokens > 0)?.date ?? days[0]?.date ?? null;
  const coverageEnd = days.at(-1)?.date ?? null;
  const failed = problems.length > 0 || !costComplete;
  return {
    ledger,
    push: {
      collectedAt,
      state: problems.length > 0 ? "error" : "ok",
      error: problems.length > 0 ? problems.join("; ") : null,
      coverageStart,
      coverageEnd,
      precision: "measured",
      costComplete: !failed && Number.isFinite(collectedAtMs),
      days,
    },
  };
}

type FetchResult = { status: number; body: unknown; location: string | null };
type PageFetch = typeof fetch;

async function postPage(
  cookie: string,
  page: number,
  lower: number,
  upper: number,
  fetchPage: PageFetch = fetch,
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
      body: JSON.stringify({ page, pageSize: PAGE_SIZE, startDate: String(lower), endDate: String(upper) }),
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

export async function fetchCursorHistory(
  cookie: string,
  untilMs: number,
  fetchPage?: PageFetch,
): Promise<UsageEvent[]> {
  const lower = 0;
  const upper = untilMs;
  if (!Number.isSafeInteger(upper) || upper < lower) throw new CursorUsageError("invalid date range");
  const pages: UsageEvent[][] = [];
  const seen = new Set<string>();
  let expected: number | null = null;
  let complete = false;
  const deadline = Date.now() + FETCH_BUDGET_MS;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    if (Date.now() > deadline) throw new CursorUsageError("history fetch exceeded time budget");
    const response = await postPage(cookie, page, lower, upper, fetchPage);
    const parsed = parseUsagePage(response.body, lower, upper);
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

/** 拉完整历史、并进本地账本。没配凭据返回 null。失败不改账本。 */
export async function collectCursorUsage(now = Date.now()): Promise<CursorUsagePush | null> {
  if (config.limitsFixture) return null;
  const accessToken = await readCursorAccessToken();
  if (!accessToken) return null;
  const session = sessionFromAccessToken(accessToken);
  const events = await fetchCursorHistory(session.cookie, now);
  const aggregated = aggregateEvents(events, now);
  const collectedAt = new Date(now).toISOString();
  const applied = applyLedger(
    await readLedger(),
    session.accountHash,
    aggregated.days,
    collectedAt,
    aggregated.costComplete,
    aggregated.unmeasured,
  );
  await writeLedger(applied.ledger);
  return applied.push;
}
