import type Anthropic from "@anthropic-ai/sdk";

import { GOD_CHAT_LIMITS } from "@shared/god-chat";

import { STATUS_VIEWS, type StatusViewKey } from "@/lib/status-views";

export type ReadStatus = (path: string) => Promise<Response>;

const VIEW_NOTES = {
  desktop: "Foreground app on LYJW's Mac right now (app name, window title if public)",
  timezone: "LYJW's current timezone (where LYJW physically is)",
  activity: "Apple Watch activity rings today (move, exercise, stand)",
  workouts: "Recent workouts with duration, energy, heart rate",
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
  githubRepo: "This site's GitHub repo stats and recent commits",
  cloudflareWorkers: "Cloudflare Workers request and error stats for this site",
  vercelDeployments: "Recent Vercel deployments of this site",
  sentry: "Error counts from Sentry for this site",
  reporters: "Health of the reporters that push data to this site",
  pulse: "24h timeline of coding, listening, watching, gaming, charging, activity (large)",
} as const satisfies Record<StatusViewKey, string>;

const VIEW_KEYS = Object.keys(VIEW_NOTES) as StatusViewKey[];

// 单次工具结果进上下文就是输入 token 花费；超长的视图截断而不是整段塞进去。
const MAX_VIEWS_PER_CALL = 4;
const MAX_CHARS_PER_VIEW = 8_000;

export const SITE_STATUS_TOOL: Anthropic.Beta.BetaTool = {
  name: "get_site_status",
  description: [
    "Read live data from LYJW's homepage (the same JSON the site's cards show).",
    "Timestamps are epoch milliseconds; the result includes the current time for comparison.",
    "Views:",
    ...VIEW_KEYS.map((key) => `- ${key}: ${VIEW_NOTES[key]}`),
  ].join("\n"),
  input_schema: {
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
  strict: true,
};

export function parseSiteStatusInput(input: unknown): StatusViewKey[] {
  const views = (input as { views?: unknown })?.views;
  if (!Array.isArray(views)) return [];
  return [...new Set(views.filter((v): v is StatusViewKey => VIEW_KEYS.includes(v as StatusViewKey)))].slice(
    0,
    MAX_VIEWS_PER_CALL,
  );
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

// Haiku 5.5 用带动态过滤的版本时，首次调用常把参数包进 {"params": …} 被判 invalid_tool_input，白耗一次 max_uses；
// 所以只有 Fable 用新版，其余模型用基础版。
export function webSearchTool(model: string): Anthropic.Beta.BetaToolUnion {
  return model.startsWith("claude-fable-")
    ? { type: "web_search_20260318", name: "web_search", max_uses: GOD_CHAT_LIMITS.maxWebSearches }
    : { type: "web_search_20250305", name: "web_search", max_uses: GOD_CHAT_LIMITS.maxWebSearches };
}
