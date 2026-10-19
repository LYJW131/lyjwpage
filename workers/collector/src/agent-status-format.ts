import type { AgentIndicator } from "@shared/agent-status-types";

export const STATUS_PAGES = {
  claude: "https://status.claude.com",
  openai: "https://status.openai.com",
  cursor: "https://status.cursor.com",
  xai: "https://status.x.ai/grok-build",
  typesafe: "https://status.typesafe.ai",
  devin: "https://www.devinstatus.com",
  apple: "https://developer.apple.com/system-status/",
  github: "https://www.githubstatus.com",
  cloudflare: "https://www.cloudflarestatus.com",
} as const;

export const MAX_INCIDENTS = 3;
const MAX_BODY = 500;

const RANK: Record<Exclude<AgentIndicator, "unavailable" | "unmonitored">, number> = {
  operational: 0,
  maintenance: 1,
  degraded: 2,
  partial_outage: 3,
  major_outage: 4,
};

export type StatuspageComponent = { name: string; indicator: AgentIndicator };

export function worst(indicators: AgentIndicator[]): AgentIndicator {
  let selected: AgentIndicator = "operational";
  let seen = false;
  for (const indicator of indicators) {
    if (indicator === "unavailable" || indicator === "unmonitored") continue;
    seen = true;
    if (RANK[indicator] > RANK[selected]) selected = indicator;
  }
  return seen ? selected : "unavailable";
}

export function displayStatus(status: string): string {
  const words = status.replaceAll("_", " ").trim().toLowerCase();
  if (!words) return "Update";
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function clip(value: string): string {
  const flat = value.replace(/\s+/g, " ").trim();
  if (flat.length <= MAX_BODY) return flat;
  return `${flat.slice(0, MAX_BODY - 1).trimEnd()}…`;
}

export function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function iso(value: string | null): string | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}
