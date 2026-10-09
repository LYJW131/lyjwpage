import { STATUS_VIEWS, type StatusViewKey } from "@/lib/status-views";

import type { SiteTool } from "./registry";

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

// 工具结果进上下文就是输入 token 花费：超长的视图截断而不是整段塞进去；一条回复里所有调用（含同一轮并行的几次）
// 合计最多读 MAX_VIEWS_PER_REPLY 个视图，读过的不再读，否则并行多调几次就能把输入撑大好几倍。
const MAX_VIEWS_PER_CALL = 4;
const MAX_VIEWS_PER_REPLY = 8;
const MAX_CHARS_PER_VIEW = 8_000;

export function isStatusViewKey(value: unknown): value is StatusViewKey {
  return VIEW_KEYS.includes(value as StatusViewKey);
}

export function parseSiteStatusInput(input: unknown): { views: StatusViewKey[]; notes: string[] } {
  const raw = (input as { views?: unknown } | null)?.views;
  const asked = Array.isArray(raw) ? [...new Set(raw)] : [];
  const known = asked.filter(isStatusViewKey);
  const unknown = asked.length - known.length;
  const later = known.slice(MAX_VIEWS_PER_CALL);
  const notes = [
    unknown && `Ignored ${unknown} unknown view name${unknown > 1 ? "s" : ""}; the valid views are listed in the tool description.`,
    later.length && `At most ${MAX_VIEWS_PER_CALL} views per call; call again for: ${later.join(", ")}.`,
  ].filter((note): note is string => Boolean(note));
  return { views: known.slice(0, MAX_VIEWS_PER_CALL), notes };
}

// 同步调用：同一轮的几次调用按顺序先分好额度再并行去读，谁读到哪些视图是确定的。
export function claimViews(requested: StatusViewKey[], read: Set<StatusViewKey>) {
  const views: StatusViewKey[] = [];
  const repeated: StatusViewKey[] = [];
  const overBudget: StatusViewKey[] = [];
  for (const key of requested) {
    if (read.has(key)) repeated.push(key);
    else if (read.size >= MAX_VIEWS_PER_REPLY) overBudget.push(key);
    else {
      read.add(key);
      views.push(key);
    }
  }
  const notes = [
    repeated.length && `Already read earlier in this reply, reuse those results: ${repeated.join(", ")}.`,
    overBudget.length && `Not read, this reply may read at most ${MAX_VIEWS_PER_REPLY} views: ${overBudget.join(", ")}.`,
  ].filter((note): note is string => Boolean(note));
  return { views, notes };
}

async function readView(read: ReadStatus, key: StatusViewKey): Promise<string> {
  try {
    const response = await read(STATUS_VIEWS[key].path);
    if (!response.ok) return JSON.stringify({ error: `HTTP ${response.status}` });
    const text = await response.text();
    return text.length > MAX_CHARS_PER_VIEW ? `${text.slice(0, MAX_CHARS_PER_VIEW)}…[truncated]` : text;
  } catch {
    return JSON.stringify({ error: "unavailable" });
  }
}

export async function runSiteStatusTool(read: ReadStatus, views: StatusViewKey[], now = Date.now()): Promise<string> {
  const results = await Promise.all(views.map(async (key) => `## ${key}\n${await readView(read, key)}`));
  const clock = new Date(now).toLocaleString("en-US", { timeZone: "Asia/Shanghai", hour12: false });
  return [`now: ${now} (${clock} Asia/Shanghai)`, ...results].join("\n\n");
}

export const SITE_STATUS_TOOL: SiteTool = {
  name: "get_site_status",
  title: "Read LYJW's live status",
  description: [
    "Read live data from LYJW's homepage (the same JSON the site's cards show).",
    "Timestamps are epoch milliseconds; the result includes the current time for comparison.",
    "Views:",
    ...VIEW_KEYS.map((key) => `- ${key}: ${VIEW_NOTES[key]}`),
  ].join("\n"),
  inputSchema: {
    type: "object",
    properties: {
      views: {
        type: "array",
        items: { type: "string", enum: VIEW_KEYS },
        description: `Which views to read (at most ${MAX_VIEWS_PER_CALL})`,
      },
    },
    required: ["views"],
    additionalProperties: false,
  },
  // 额度在第一个 await 之前占好（claimViews 的前提）。
  async run(input, { readStatus }, ledger) {
    const parsed = parseSiteStatusInput(input);
    const { views, notes } = claimViews(parsed.views, ledger.views);
    const read = views.length ? await runSiteStatusTool(readStatus, views) : "";
    const text = [read, ...parsed.notes, ...notes].filter(Boolean).join("\n\n") || "No valid views requested.";
    return { text, isError: !views.length, ...(views.length && { views }) };
  },
};
