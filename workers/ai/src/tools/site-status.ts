import { STATUS_VIEWS, type StatusViewKey } from "@/lib/status-views";

import { isTimeout, withTimeout } from "./deadline";
import type { SiteTool, ToolLedger } from "./registry";

export type ReadStatus = (path: string) => Promise<Response>;

const VIEW_NOTES = {
  desktop: "Foreground app on LYJW's Mac right now (app name, window title if public)",
  timezone: "LYJW's current timezone (where LYJW physically is)",
  activity: "Apple Watch activity rings today (move, exercise, stand)",
  workouts: "Recent workouts: type, start time, duration, distance, active energy",
  server: "Exit-node server: uptime, CPU, memory, network, monthly traffic",
  charger: "Anker charger ports: devices charging, power, protocol",
  powerBank: "Anker power bank: battery %, charging, ports",
  listening: "Recently played Apple Music tracks",
  nowListening: "Song playing right now (Apple Music / HomePod), or idle",
  coding: "AI coding token usage and API-equivalent cost over recent days",
  codingNow: "Which coding agents (Claude Code, Codex, Cursor…) were active recently",
  codingYear: "Daily coding token totals over the past year (heatmap data, large)",
  limits: "Coding agent account plans and rate-limit windows",
  agentStatus: "Status pages of AI providers (operational / incidents)",
  watching: "Recently watched movies and episodes on Emby",
  nowWatching: "What is playing on Emby right now",
  playing: "Recently played PlayStation games",
  playingNow: "PlayStation online status and current game",
  questNow: "Meta Quest current status",
  trophies: "PlayStation trophy profile and recent trophy progress",
  githubChart: "GitHub contribution chart",
  githubRepo: "This site's GitHub repo: totals, contributors and the latest commit titles (refreshed periodically, may lag by up to half an hour)",
  cloudflareWorkers: "Cloudflare Workers request and error stats for this site",
  vercelDeployments: "Recent Vercel deployments of this site",
  sentry: "Error counts from Sentry for this site",
  reporters: "Health of the reporters that push data to this site",
  pulse: "24h timeline of coding, listening, watching, gaming, charging, activity (large)",
} as const satisfies Record<StatusViewKey, string>;

const VIEW_KEYS = Object.keys(VIEW_NOTES) as StatusViewKey[];

// 工具结果进上下文就是输入 token 花费：默认去掉图片字段、长列表分页，兜底仍截断超长视图；一条回复里所有调用（含同一轮并行的几次）
// 合计最多读 MAX_VIEWS_PER_REPLY 次（视图 + 位置 + query + detail 各算一次），完全相同的读取不再读，否则并行多调几次就能把输入撑大好几倍。
const MAX_VIEWS_PER_CALL = 4;
const MAX_VIEWS_PER_REPLY = 8;
const MAX_CHARS_PER_VIEW = 8_000;
const PAGE_SIZE = 20;
const MAX_QUERY_CHARS = 200;

const DETAILS = ["summary", "full"] as const;
type Detail = (typeof DETAILS)[number];

export type StatusPage = { offset: number; query: string; detail: Detail };
const FIRST_PAGE: StatusPage = { offset: 0, query: "", detail: "summary" };

type Cursor = StatusPage & { view: StatusViewKey; totals: number[] };

export type SiteStatusInput = { views: StatusViewKey[]; notes: string[]; page: StatusPage; cursor?: Cursor; badCursor?: true };

const IMAGE_KEY_WORDS = new Set(["cover", "covers", "artwork", "artworks", "image", "images", "icon", "icons", "thumbnail", "thumbnails", "thumb", "avatar", "avatars", "poster", "posters", "backdrop", "backdrops", "logo", "banner"]);
const IMAGE_URL = /^(?:data:image\/|\/img\/|(?:https?:\/\/|\/)[^\s?#]+\.(?:png|jpe?g|gif|webp|avif|svg|ico|heic)(?:[?#]|$))/i;

export function isImageField(key: string, value: unknown): boolean {
  const words = key.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[\s_-]+/);
  return words.some((word) => IMAGE_KEY_WORDS.has(word)) || (typeof value === "string" && IMAGE_URL.test(value));
}

export function isStatusViewKey(value: unknown): value is StatusViewKey {
  return VIEW_KEYS.includes(value as StatusViewKey);
}

const normalize = (text: string) => text.normalize("NFKC").toLowerCase();

function encodeCursor(cursor: Cursor): string {
  const bytes = new TextEncoder().encode(JSON.stringify([cursor.view, cursor.offset, cursor.query, cursor.detail, cursor.totals]));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeCursor(raw: unknown): Cursor | null {
  if (typeof raw !== "string" || !/^[A-Za-z0-9_-]{1,2000}$/.test(raw)) return null;
  try {
    const binary = atob(raw.replace(/-/g, "+").replace(/_/g, "/"));
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(Uint8Array.from(binary, (char) => char.charCodeAt(0))));
    if (!Array.isArray(parsed) || parsed.length !== 5) return null;
    const [view, offset, query, detail, totals] = parsed as unknown[];
    if (!isStatusViewKey(view) || !Number.isSafeInteger(offset) || (offset as number) <= 0 || typeof query !== "string") return null;
    if (!DETAILS.includes(detail as Detail) || !Array.isArray(totals) || !totals.every((n) => Number.isSafeInteger(n) && n >= 0)) return null;
    return { view, offset: offset as number, query, detail: detail as Detail, totals: totals as number[] };
  } catch {
    return null;
  }
}

export function parseSiteStatusInput(input: unknown): SiteStatusInput {
  const args = (input ?? {}) as { views?: unknown; detail?: unknown; query?: unknown; cursor?: unknown };
  if (args.cursor !== undefined) {
    const cursor = decodeCursor(args.cursor);
    if (!cursor) return { views: [], notes: [], page: FIRST_PAGE, badCursor: true };
    const ignored = (["views", "detail", "query"] as const).filter((name) => args[name] !== undefined);
    const notes = ignored.length ? [`cursor given, so ${ignored.join(", ")} ${ignored.length > 1 ? "were" : "was"} ignored; the cursor keeps its own view, query and detail.`] : [];
    return { views: [cursor.view], notes, page: { offset: cursor.offset, query: cursor.query, detail: cursor.detail }, cursor };
  }
  const raw = args.views;
  const asked = Array.isArray(raw) ? [...new Set(raw)] : [];
  const known = asked.filter(isStatusViewKey);
  const unknown = asked.length - known.length;
  const later = known.slice(MAX_VIEWS_PER_CALL);
  const badDetail = args.detail !== undefined && !DETAILS.includes(args.detail as Detail);
  const notes = [
    unknown && `Ignored ${unknown} unknown view name${unknown > 1 ? "s" : ""}; the valid views are listed in the tool description.`,
    later.length && `At most ${MAX_VIEWS_PER_CALL} views per call; call again for: ${later.join(", ")}.`,
    badDetail && `Unknown detail, used "summary"; detail is "summary" or "full".`,
    args.query !== undefined && typeof args.query !== "string" && "Ignored query: it must be a string.",
  ].filter((note): note is string => Boolean(note));
  const query = typeof args.query === "string" ? args.query.trim().slice(0, MAX_QUERY_CHARS) : "";
  const detail = badDetail || args.detail === undefined ? "summary" : (args.detail as Detail);
  return { views: known.slice(0, MAX_VIEWS_PER_CALL), notes, page: { offset: 0, query, detail } };
}

const readKey = (view: StatusViewKey, page: StatusPage) => JSON.stringify([view, page.offset, normalize(page.query), page.detail]);

// 同步调用：同一轮的几次调用按顺序先分好额度再并行去读，谁读到哪些视图是确定的。
export function claimViews(requested: StatusViewKey[], ledger: ToolLedger, page: StatusPage = FIRST_PAGE) {
  const reads = (ledger.reads ??= new Set());
  const views: StatusViewKey[] = [];
  const repeated: StatusViewKey[] = [];
  const overBudget: StatusViewKey[] = [];
  for (const key of requested) {
    const id = readKey(key, page);
    if (reads.has(id)) repeated.push(key);
    else if (reads.size >= MAX_VIEWS_PER_REPLY) overBudget.push(key);
    else {
      reads.add(id);
      ledger.views.add(key);
      views.push(key);
    }
  }
  const notes = [
    repeated.length && `Already read earlier in this reply, reuse those results: ${repeated.join(", ")}.`,
    overBudget.length && `Not read, this reply may read at most ${MAX_VIEWS_PER_REPLY} views or pages: ${overBudget.join(", ")}.`,
  ].filter((note): note is string => Boolean(note));
  return { views, notes };
}

function strip(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(strip);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key, child]) => !isImageField(key, child))
      .map(([key, child]) => [key, strip(child)]),
  );
}

function contains(value: unknown, needle: string): boolean {
  if (typeof value === "string") return normalize(value).includes(needle);
  if (typeof value === "number" || typeof value === "boolean") return String(value).includes(needle);
  if (Array.isArray(value)) return value.some((child) => contains(child, needle));
  if (value && typeof value === "object") return Object.values(value).some((child) => contains(child, needle));
  return false;
}

// 热力图类视图是 origin 起逐日的数值数组，模型按下标数日期既费步数又容易数错，所以附上按月合计，键为 `<数组名>ByMonth`。
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function monthlyTotals(origin: string, values: number[]): Record<string, number> {
  const start = Date.parse(`${origin}T00:00:00Z`);
  const totals: Record<string, number> = {};
  values.forEach((value, index) => {
    const month = new Date(start + index * 86_400_000).toISOString().slice(0, 7);
    totals[month] = (totals[month] ?? 0) + value;
  });
  return totals;
}

export function withMonthlyTotals(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withMonthlyTotals);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const start = typeof record.from === "string" && DAY.test(record.from) ? record.from : record.origin;
  const out = Object.fromEntries(Object.entries(record).map(([key, child]) => [key, withMonthlyTotals(child)]));
  if (typeof start !== "string" || !DAY.test(start)) return out;
  for (const [key, child] of Object.entries(record)) {
    if (Array.isArray(child) && child.length && child.every((item) => typeof item === "number")) out[`${key}ByMonth`] = monthlyTotals(start, child);
  }
  return out;
}

const isScalarList = (value: unknown[]) => value.length > 0 && value.every((item) => item === null || typeof item !== "object");

type PagedList = { path: string; total: number; before: number };

// 只处理最外层的数组（不在别的数组项里的）：搜到的条目整项保留，项里的子列表不再按 query 过滤或分页，
// 否则「游戏名匹配」会把这个游戏的奖杯列表筛空，嵌套列表也没法和外层共用同一个位置。
// 纯数值、字符串数组（逐日序列）整份保留：按下标对应日期，分页或筛选都会打乱对应关系，体积靠 MAX_CHARS_PER_VIEW 兜底。
function collectLists(value: unknown, path: string, needle: string, lists: PagedList[]): unknown {
  if (Array.isArray(value) && isScalarList(value)) return value;
  if (Array.isArray(value)) {
    const items = needle ? value.filter((item) => contains(item, needle)) : value;
    if (needle || value.length > PAGE_SIZE) lists.push({ path: path || "(root)", total: items.length, before: value.length });
    return items;
  }
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, collectLists(child, path ? `${path}.${key}` : key, needle, lists)]));
}

type ViewResult = { section: string; outOfRange?: true; error?: string };

function pageView(view: StatusViewKey, data: unknown, page: StatusPage, cursor: Cursor | undefined): ViewResult {
  const needle = normalize(page.query);
  const lists: PagedList[] = [];
  const filtered = collectLists(withMonthlyTotals(page.detail === "summary" ? strip(data) : data), "", needle, lists);
  let longest = 0;
  for (const list of lists) if (list.total > longest) longest = list.total;
  if (page.offset > 0 && page.offset >= longest) return { section: "", outOfRange: true };
  const totals = lists.map((list) => list.total);
  const next = page.offset + PAGE_SIZE < longest ? encodeCursor({ view, ...page, offset: page.offset + PAGE_SIZE, totals }) : undefined;
  const wrapped = new Set(lists.map((list) => list.path));
  const replace = (value: unknown, path: string): unknown => {
    if (Array.isArray(value)) {
      if (!wrapped.has(path || "(root)")) return value;
      const list = lists.find((candidate) => candidate.path === (path || "(root)"));
      const more = page.offset + PAGE_SIZE < value.length;
      return {
        total: value.length,
        ...(needle && { totalBeforeQuery: list?.before ?? value.length }),
        items: value.slice(page.offset, page.offset + PAGE_SIZE),
        ...(more && next && { nextCursor: next }),
      };
    }
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replace(child, path ? `${path}.${key}` : key)]));
  };
  const json = JSON.stringify(replace(filtered, ""));
  const listNotes = lists.map((list) => {
    const shown = list.total > page.offset ? `items ${page.offset + 1}-${Math.min(list.total, page.offset + PAGE_SIZE)}` : "no items on this page";
    const count = needle ? `${list.total} of ${list.before} match` : `${list.total} total`;
    return `${list.path} (${count}, ${list.total ? shown : "0 items"})`;
  });
  const summary = [
    `detail=${page.detail}`,
    needle && `query "${page.query}"`,
    needle && !lists.length && "no lists to search",
    lists.length ? `lists: ${listNotes.join("; ")}` : "no paged lists",
    next ? `nextCursor: ${next}` : "last page",
    cursor && JSON.stringify(cursor.totals) !== JSON.stringify(totals) && "the lists changed while paging, items may repeat or be missing",
  ].filter(Boolean);
  const body = json.length > MAX_CHARS_PER_VIEW ? `${json.slice(0, MAX_CHARS_PER_VIEW)}…[truncated]` : json;
  return { section: `${summary.join(" | ")}\n${body}` };
}

function logReadFailure(view: StatusViewKey, error: string) {
  console.warn("[site-status] read failed", JSON.stringify({ view, error }));
}

async function readView(read: ReadStatus, key: StatusViewKey, page: StatusPage, cursor?: Cursor): Promise<ViewResult> {
  let text: string;
  try {
    const response = await withTimeout(read(STATUS_VIEWS[key].path));
    if (!response.ok) {
      try { await response.body?.cancel(); } catch {
        // 取消失败不能盖掉已经拿到的状态码。
      }
      const error = `HTTP ${response.status}`;
      logReadFailure(key, error);
      return { section: JSON.stringify({ error }), error };
    }
    text = await response.text();
  } catch (error) {
    const reason = isTimeout(error) ? "timed out" : "unavailable";
    logReadFailure(key, reason);
    return { section: JSON.stringify({ error: reason }), error: reason };
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    logReadFailure(key, "not JSON");
    return { section: JSON.stringify({ error: "not JSON" }), error: "not JSON" };
  }
  try {
    return pageView(key, data, page, cursor);
  } catch {
    logReadFailure(key, "unavailable");
    return { section: JSON.stringify({ error: "unavailable" }), error: "unavailable" };
  }
}

const clockLine = (now: number) => `now: ${now} (${new Date(now).toLocaleString("en-US", { timeZone: "Asia/Shanghai", hour12: false })} Asia/Shanghai)`;

export async function runSiteStatusTool(read: ReadStatus, views: StatusViewKey[], now = Date.now(), page: StatusPage = FIRST_PAGE): Promise<{ text: string; failed: StatusViewKey[] }> {
  const results = await Promise.all(views.map(async (key) => {
    const result = await readView(read, key, page);
    return { key, failed: Boolean(result.error), section: `## ${key}\n${result.section}` };
  }));
  return {
    text: [clockLine(now), ...results.map((result) => result.section)].join("\n\n"),
    failed: results.filter((result) => result.failed).map((result) => result.key),
  };
}

const INVALID_CURSOR = "Invalid cursor: it is not one this tool returned, or the list no longer reaches that position. Call get_site_status again without cursor to start from the first page.";

export const SITE_STATUS_TOOL: SiteTool = {
  name: "get_site_status",
  title: "Read LYJW's live status",
  description: [
    "Read live data from LYJW's homepage (the same JSON the site's cards show).",
    "Timestamps are epoch milliseconds; the result includes the current time for comparison.",
    `By default image fields (covers, artwork, icons, avatars, image URLs) are removed; pass detail="full" only when you need image links.`,
    "Long lists are paged: each view starts with a summary line naming the paged lists, their totals and the nextCursor. Pass nextCursor back unchanged as cursor to read the next page; no nextCursor means the last page. The page size is chosen by the server.",
    "To look for a specific item (a game, song, show or trophy), use query first: it keeps the list items that contain the text, ignoring case and full/half width. Game names may be in Chinese, English or Japanese, so try another name when nothing matches.",
    "Don't conclude that something is absent until you have searched for it or read every page.",
    "If a view comes back as an error, it was not read. Say so; do not invent its data or treat the error as an empty result.",
    "Views:",
    ...VIEW_KEYS.map((key) => `- ${key}: ${VIEW_NOTES[key]}`),
  ].join("\n"),
  inputSchema: {
    type: "object",
    properties: {
      views: {
        type: "array",
        items: { type: "string", enum: VIEW_KEYS },
        description: `Which views to read (at most ${MAX_VIEWS_PER_CALL}); may be omitted when cursor is given`,
      },
      detail: { type: "string", enum: [...DETAILS], description: `"summary" (default) drops image fields; "full" keeps every field` },
      query: { type: "string", description: "Text to search for in long lists; only matching items are kept" },
      cursor: { type: "string", description: "The nextCursor from an earlier result, passed back unchanged; it decides the view, query and detail" },
    },
    required: [],
    additionalProperties: false,
  },
  // 额度在第一个 await 之前占好（claimViews 的前提）。
  async run(input, { readStatus }, ledger) {
    const parsed = parseSiteStatusInput(input);
    if (parsed.badCursor) return { text: INVALID_CURSOR, isError: true };
    const seen = new Set(ledger.views);
    const { views, notes } = claimViews(parsed.views, ledger, parsed.page);
    const dropUnread = (key: StatusViewKey) => {
      if (!seen.has(key)) ledger.views.delete(key);
    };
    if (parsed.cursor && views.length) {
      const view = parsed.cursor.view;
      const result = await readView(readStatus, view, parsed.page, parsed.cursor);
      if (result.outOfRange) {
        ledger.reads?.delete(readKey(view, parsed.page));
        dropUnread(view);
        return { text: INVALID_CURSOR, isError: true };
      }
      if (result.error) dropUnread(view);
      const text = [`${clockLine(Date.now())}\n\n## ${view}\n${result.section}`, ...parsed.notes].join("\n\n");
      return { text, isError: Boolean(result.error), ...(!result.error && { views }) };
    }
    if (!views.length) {
      const text = [...parsed.notes, ...notes].filter(Boolean).join("\n\n") || "No valid views requested.";
      return { text, isError: true };
    }
    const read = await runSiteStatusTool(readStatus, views, Date.now(), parsed.page);
    const failed = new Set(read.failed);
    for (const key of failed) dropUnread(key);
    const ok = views.filter((key) => !failed.has(key));
    const text = [read.text, ...parsed.notes, ...notes].filter(Boolean).join("\n\n");
    return { text, isError: ok.length === 0, ...(ok.length && { views: ok }) };
  },
};
