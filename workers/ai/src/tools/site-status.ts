import { CODING_ACTIVE_WINDOW_MS } from "@shared/coding-usage-view";
import { site } from "@shared/site";
import { STATUS_VIEWS, type StatusViewKey } from "@shared/status-views";
import type { NowListeningPayload } from "@shared/types";

import { base64url, decodeBase64url } from "../crypto";
import { codingYearForModel } from "./coding-year-shape";
import { MERGE_GAP_SEC, pulseForModel } from "./pulse-shape";
import type { SiteTool, ToolLedger } from "./registry";
import { collectLists, normalize, PAGE_SIZE, strip, withMonthlyTotals, type PagedList } from "./status-shape";

export { isImageField, withMonthlyTotals } from "./status-shape";

export type ReadStatus = (path: string) => Promise<Response>;

const VIEW_NOTES = {
  desktop: "Foreground app on LYJW's Mac right now (app name, window title if public); loginwindow means the Mac is locked, so LYJW is away from it",
  timezone: "LYJW's current timezone (where LYJW physically is)",
  activity: "Apple Watch activity rings today (move, exercise, stand)",
  workouts: "Recent workouts: type, start time, duration, distance, active energy",
  server: "Exit-node server: uptime, CPU, memory, network, monthly traffic",
  charger: "Anker charger ports: devices charging, power, protocol",
  powerBank: "Anker power bank: battery %, charging, ports",
  listening: "Recently played Apple Music songs, albums and playlists, newest first, without play times; for what LYJW listened to and when over the past 24 hours, read pulse",
  nowListening: "Song playing right now: reported by the Mac or HomePod (music), or inferred on another device from Apple Music play history (elsewhere); idle only covers the Mac and HomePod",
  coding: "AI coding token totals and API-equivalent cost since tracking began, top models and per-agent totals; no per-day numbers (those are in codingYear)",
  codingNow: `Which coding agents (Claude Code, Codex, Cursor…) were active recently. Each activity's source says where it ran: mac = on LYJW's Mac; mac-otlp = an agent's built-in telemetry on LYJW's Mac (Devin CLI); agents-otlp = built-in telemetry from cloud sessions (Claude Code, Devin CLI); agents = the vendor's cloud (e.g. Cursor background agents). Cloud agents run on their own (scheduled jobs, long tasks), so only activity on the Mac (mac or mac-otlp) with an unlocked desktop suggests LYJW is at the computer. lastActivityAt is the latest report from a session that keeps reporting while it works: the site shows an agent as in use right now when that is within the last ${CODING_ACTIVE_WINDOW_MS / 60_000} minutes (ignoring mac and mac-otlp while the Mac has declared itself offline), so describe such an agent as working now, not as last active some minutes ago`,
  codingYear: "Daily coding token totals over the past year, with per-month totals, the last 14 days by date, every model's tokens per day in modelsByDay (newest first, paged; query a date like 2026-09-10 or a model name to find older days) and ready-made 7-day / 30-day / all sums (large)",
  limits: "Coding agent account plans and rate-limit windows",
  limitsHistory: "Past readings of Claude Code's weekly all-models limit: hourly for the last 8 days, daily before that over three weeks. Each point is [at, usedPercent, resetsAt]; these tuple times are not converted: at is epoch milliseconds and resetsAt is Unix seconds",
  agentStatus: "Status pages of AI providers (operational / incidents)",
  watching: "Recently watched movies and episodes on Emby",
  nowWatching: "What is playing on Emby right now",
  playing: "Recently played PlayStation games",
  playingNow: "PlayStation online status and current game",
  questNow: "Meta Quest current status",
  focusNow: "Whether LYJW's iPhone is in Sleep or Mindfulness focus right now (LYJW is not to be disturbed), and since when",
  trophies: "PlayStation trophy profile and recent trophy progress",
  githubChart: "Daily GitHub contribution counts over the past year, with per-month totals, the last 14 days by date and ready-made 7-day / 30-day / all sums",
  githubRepo: "This site's GitHub repo: totals, contributors and the latest commit titles (refreshed periodically, may lag by up to half an hour)",
  cloudflareWorkers: "Cloudflare Workers request and error stats for this site",
  siteDeployments: "Site Worker production deployment, recent builds, pageviews and PageSpeed samples",
  health: "Uptime, API cron heartbeat, error counts and real-visitor Web Vitals for this site",
  reporters: "Health of the reporters that push data to this site",
  pulse: `LYJW's past 24 hours as time spans per lane: songs played on the Mac or HomePod (listening.spans) and songs inferred from Apple Music history on another device (listening.inferredElsewhere), shows watched, games played, stretches with a coding app in front on LYJW's Mac (coding.driverSpans; agents running alone are left out), with every lane's totals (including tokens, charging and steps) first under totals. A span's from/to may bridge breaks of up to ${MERGE_GAP_SEC / 60} minutes and its minutes counts only the time actually active. In totals.coding, humanSeconds + bothSeconds is LYJW's driver time (a coding app in front on LYJW's Mac; keyboard activity is not tracked, so LYJW may have stepped away); agentSeconds is agents running without a coding app in front. Report driver time as LYJW's coding time, never the sum of all three`,
  digest: "Hourly AI-written summary of LYJW's past 24 hours, derived from the other views (read those for exact numbers)",
} as const satisfies Record<StatusViewKey, string>;

const VIEW_KEYS = Object.keys(VIEW_NOTES) as StatusViewKey[];

// 工具结果进上下文就是输入 token 花费：默认去掉图片字段、长列表分页，兜底仍截断超长视图；一条回复里所有调用（含同一轮并行的几次）
// 合计最多读 MAX_VIEWS_PER_REPLY 次（视图 + 位置 + query + detail 各算一次），完全相同的读取不再读，否则并行多调几次就能把输入撑大好几倍。
const MAX_VIEWS_PER_CALL = 4;
const MAX_VIEWS_PER_REPLY = 8;
const MAX_CHARS_PER_VIEW = 8_000;
const MAX_QUERY_CHARS = 200;

const DETAILS = ["summary", "full"] as const;
type Detail = (typeof DETAILS)[number];

export type StatusPage = { offset: number; query: string; detail: Detail };
const FIRST_PAGE: StatusPage = { offset: 0, query: "", detail: "summary" };

type Cursor = StatusPage & { view: StatusViewKey; totals: number[] };

export type SiteStatusInput = { views: StatusViewKey[]; notes: string[]; page: StatusPage; cursor?: Cursor; badCursor?: true };

export function isStatusViewKey(value: unknown): value is StatusViewKey {
  return VIEW_KEYS.includes(value as StatusViewKey);
}

function encodeCursor(cursor: Cursor): string {
  const bytes = new TextEncoder().encode(JSON.stringify([cursor.view, cursor.offset, cursor.query, cursor.detail, cursor.totals]));
  return base64url(bytes);
}

function decodeCursor(raw: unknown): Cursor | null {
  if (typeof raw !== "string" || !/^[A-Za-z0-9_-]{1,2000}$/.test(raw)) return null;
  try {
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(decodeBase64url(raw)));
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

type ViewResult = { section: string; outOfRange?: true };

const clock = (ms: number) => {
  const seconds = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

// 照字面读，模型会把 idle: true 当成「没在听」、把 elsewhere 当成「刚才在别处放过」；其实 idle 只管 Mac / HomePod，
// elsewhere 是推断出的此刻多半正在 iPhone 等设备上放的那首，所以把这层含义直接说给模型。
// 只陈述事实，不写现成的句子或「Say …」式的措辞要求：Haiku 会照抄这些英文句子，回答就跟着变成英文。
export function nowListeningHint(data: unknown, now: number): string | null {
  const payload = (data as { data?: NowListeningPayload } | null)?.data;
  const elsewhere = payload?.elsewhere;
  if (!payload || payload.music || !elsewhere) return null;
  const song = `"${elsewhere.title}"${elsewhere.artist ? ` by ${elsewhere.artist}` : ""}`;
  const source = "Field meaning: idle and music: null only cover the Mac and HomePod; elsewhere is inferred from Apple Music play history on a device without a reporter (iPhone, iPad or the web player)";
  if (now < elsewhere.startedAt + elsewhere.durationMs) {
    return `${source}. Its estimated position is ${clock(now - elsewhere.startedAt)} of ${clock(elsewhere.durationMs)}, so LYJW is most likely listening to ${song} right now, not idle.`;
  }
  const next = elsewhere.next ? ` (likely "${elsewhere.next.title}"${elsewhere.next.artist ? ` by ${elsewhere.next.artist}` : ""})` : "";
  return `${source}. ${song} has just run out and the next song${next} has not shown up in play history yet, so LYJW is most likely still listening, not idle.`;
}

const VIEW_SHAPES: Partial<Record<StatusViewKey, (data: unknown) => unknown>> = {
  pulse: pulseForModel,
  codingYear: codingYearForModel,
};

const VIEW_HINTS: Partial<Record<StatusViewKey, (data: unknown, now: number) => string | null>> = {
  nowListening: nowListeningHint,
};

const clip = (text: string) => (text.length > MAX_CHARS_PER_VIEW ? `${text.slice(0, MAX_CHARS_PER_VIEW)}…[truncated]` : text);

function pageView(view: StatusViewKey, raw: unknown, page: StatusPage, cursor: Cursor | undefined, now: number): ViewResult {
  const data = VIEW_SHAPES[view]?.(raw) ?? raw;
  const needle = normalize(page.query);
  const lists: PagedList[] = [];
  const filtered = collectLists(withMonthlyTotals(page.detail === "summary" ? strip(data) : data), "", needle, lists);
  const longest = Math.max(0, ...lists.map((list) => list.total));
  if (page.offset > 0 && page.offset >= longest) return { section: "", outOfRange: true };
  const totals = lists.map((list) => list.total);
  const next = page.offset + PAGE_SIZE < longest ? encodeCursor({ view, ...page, offset: page.offset + PAGE_SIZE, totals }) : undefined;
  const byPath = new Map(lists.map((list) => [list.path, list]));
  const replace = (value: unknown, path: string): unknown => {
    if (Array.isArray(value)) {
      const list = byPath.get(path || "(root)");
      if (!list) return value;
      const more = page.offset + PAGE_SIZE < value.length;
      return {
        total: value.length,
        ...(needle && { totalBeforeQuery: list.before }),
        items: value.slice(page.offset, page.offset + PAGE_SIZE),
        ...(more && next && { nextCursor: next }),
      };
    }
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, replace(child, path ? `${path}.${key}` : key)]));
  };
  const json = JSON.stringify(replace(filtered, ""), (key, value) => localTimes(key, value, now));
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
  const hint = page.offset === 0 ? VIEW_HINTS[view]?.(raw, now) : null;
  return { section: [summary.join(" | "), hint, clip(json)].filter(Boolean).join("\n") };
}

async function readView(read: ReadStatus, key: StatusViewKey, page: StatusPage, now: number, cursor?: Cursor): Promise<ViewResult> {
  let text: string;
  try {
    const response = await read(STATUS_VIEWS[key].path);
    if (!response.ok) return { section: JSON.stringify({ error: `HTTP ${response.status}` }) };
    text = await response.text();
  } catch {
    return { section: JSON.stringify({ error: "unavailable" }) };
  }
  try {
    return pageView(key, JSON.parse(text), page, cursor, now);
  } catch {
    if (page.offset > 0) return { section: "", outOfRange: true };
    return { section: `not JSON, returned as is\n${clip(text)}` };
  }
}

const STATUS_TIME_ZONE = site.timezone;
const LOCAL_TIME = new Intl.DateTimeFormat("sv-SE", { timeZone: STATUS_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const localTime = (ms: number) => LOCAL_TIME.format(ms);

// 模型自己换算 epoch 毫秒常把日期、甚至年份算错，所以时间点字段直接给本地时间；时长字段（…Ms）照旧是毫秒。
// 「昨天」「今天」也由这里按本地日历日算好附在后面：模型自己比日期会把昨天 02:28 说成「昨晚」甚至「今天凌晨」。
// resetsAt 是 Unix 秒，Emby 的 playedAt 是 ISO 字符串，pulse 的 window.from / to 与 PageSpeed 的 start 不带 At 后缀。
const TIME_KEY = /(At|^since|^from|^to|^start)$/;
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const DAY_MS = 86_400_000;
const localDay = (ms: number) => Date.parse(`${localTime(ms).slice(0, 10)}T00:00:00Z`) / DAY_MS;
function relativeDay(ms: number, now: number): string {
  const days = localDay(now) - localDay(ms);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days === -1) return "tomorrow";
  return days > 0 ? `${days} days ago` : `in ${-days} days`;
}
const stamp = (ms: number, now: number) => `${localTime(ms)} (${relativeDay(ms, now)})`;
function localTimes(key: string, value: unknown, now: number): unknown {
  if (!TIME_KEY.test(key)) return value;
  if (typeof value === "number") {
    if (value > 1e12 && value < 1e14) return stamp(value, now);
    if (key.endsWith("At") && value > 1e9 && value < 1e11) return stamp(value * 1000, now);
  }
  if (typeof value === "string" && ISO_TIME.test(value)) {
    const ms = Date.parse(value);
    if (Number.isFinite(ms)) return stamp(ms, now);
  }
  return value;
}

const clockLine = (now: number) => `now: ${now} (${localTime(now)} ${STATUS_TIME_ZONE})`;

export async function runSiteStatusTool(read: ReadStatus, views: StatusViewKey[], now = Date.now(), page: StatusPage = FIRST_PAGE): Promise<string> {
  const results = await Promise.all(views.map(async (key) => `## ${key}\n${(await readView(read, key, page, now)).section}`));
  return [clockLine(now), ...results].join("\n\n");
}

const INVALID_CURSOR = "Invalid cursor: it is not one this tool returned, or the list no longer reaches that position. Call get_site_status again without cursor to start from the first page.";

export const SITE_STATUS_TOOL: SiteTool = {
  name: "get_site_status",
  title: "Read LYJW's live status",
  description: [
    "Read live data from LYJW's homepage (the same JSON the site's cards show).",
    `Points in time (fields ending in At, since, window from / to, start) are already converted to ${STATUS_TIME_ZONE} local time as YYYY-MM-DD HH:mm followed by the calendar day relative to now in brackets (today, yesterday, N days ago); quote them as given instead of recomputing, use that label for words like today or yesterday, and treat 00:00–05:59 as the early morning of that day (凌晨), not the night before. Durations ending in Ms stay milliseconds. The result starts with the current time for comparison.`,
    `By default image fields (covers, artwork, icons, avatars, image URLs) are removed; pass detail="full" only when you need image links.`,
    "Long lists are paged: each view starts with a summary line naming the paged lists, their totals and the nextCursor. Pass nextCursor back unchanged as cursor to read the next page; no nextCursor means the last page. The page size is chosen by the server.",
    "To look for a specific item (a game, song, show or trophy), use query first: it keeps the list items that contain the text, ignoring case and full/half width. Game names may be in Chinese, English or Japanese, so try another name when nothing matches.",
    "Don't conclude that something is absent until you have searched for it or read every page.",
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
    const hadView = parsed.cursor && ledger.views.has(parsed.cursor.view);
    const { views, notes } = claimViews(parsed.views, ledger, parsed.page);
    if (parsed.cursor && views.length) {
      const view = parsed.cursor.view;
      const now = Date.now();
      const result = await readView(readStatus, view, parsed.page, now, parsed.cursor);
      if (result.outOfRange) {
        ledger.reads?.delete(readKey(view, parsed.page));
        if (!hadView) ledger.views.delete(view);
        return { text: INVALID_CURSOR, isError: true };
      }
      const text = [`${clockLine(now)}\n\n## ${view}\n${result.section}`, ...parsed.notes].join("\n\n");
      return { text, isError: false, views };
    }
    const read = views.length ? await runSiteStatusTool(readStatus, views, Date.now(), parsed.page) : "";
    const text = [read, ...parsed.notes, ...notes].filter(Boolean).join("\n\n") || "No valid views requested.";
    return { text, isError: !views.length, ...(views.length && { views }) };
  },
};
