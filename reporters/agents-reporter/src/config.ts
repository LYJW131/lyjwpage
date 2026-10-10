const KNOWN_AGENTS = ["claude", "codex", "grok", "cursor", "antigravity"] as const;
export type AgentId = (typeof KNOWN_AGENTS)[number];

function ms(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} 必须是正数`);
  return value;
}

function trimSlash(url: string) {
  return url.replace(/\/+$/, "");
}

function flag(name: string): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

function agentIds(): AgentId[] {
  const raw = process.env.AGENT_IDS?.trim() || "claude,codex,grok,cursor,antigravity";
  const ids: AgentId[] = [];
  for (const part of raw.split(",")) {
    const id = part.trim().toLowerCase();
    if (!id) continue;
    if (!(KNOWN_AGENTS as readonly string[]).includes(id)) {
      throw new Error(`AGENT_IDS 里有不认识的 id：${id}`);
    }
    if (!ids.includes(id as AgentId)) ids.push(id as AgentId);
  }
  if (ids.length === 0) throw new Error("AGENT_IDS 不能是空的");
  return ids;
}

const dryRun = flag("DRY_RUN");
const siteUrl = process.env.SITE_URL?.trim() ?? "";

export const config = {
  dryRun,

  reporterCommit: process.env.REPORTER_COMMIT?.trim() || null,
  pushLedgerPath: process.env.PUSH_LEDGER_PATH === undefined ? "/data/pushes.json" : process.env.PUSH_LEDGER_PATH.trim(),

  site: {
    ingestUrl: process.env.SITE_INGEST_URL?.trim() ?? "",
    accessClientId: process.env.ACCESS_CLIENT_ID?.trim() ?? "",
    accessClientSecret: process.env.ACCESS_CLIENT_SECRET?.trim() ?? "",
  },

  cadence: {
    activeIntervalMs: ms("ACTIVE_INTERVAL_MS", 300_000),
    idleIntervalMs: ms("IDLE_INTERVAL_MS", 3_600_000),
    activityUrl: siteUrl ? `${trimSlash(siteUrl)}/api/status/coding/now` : "",
    activityTimeoutMs: ms("ACTIVITY_TIMEOUT_MS", 2_500),
  },
  pushTimeoutMs: ms("PUSH_TIMEOUT_MS", 30_000),

  cursorNow: {
    fastIntervalMs: ms("CURSOR_NOW_FAST_INTERVAL_MS", 60_000),
    maxIntervalMs: ms("CURSOR_NOW_MAX_INTERVAL_MS", 240_000),
  },

  claudeOAuth: {
    tokenUrl: process.env.CLAUDE_OAUTH_TOKEN_URL?.trim() ?? "",
    clientId: process.env.CLAUDE_OAUTH_CLIENT_ID?.trim() ?? "",
  },

  claudeBin: process.env.CLAUDE_BIN?.trim() || "claude",

  agentIds: agentIds(),

  cursorAuthToken: process.env.CURSOR_AUTH_TOKEN?.trim() ?? "",

  antigravityPlanLabel: process.env.ANTIGRAVITY_PLAN_LABEL?.trim() ?? "",

  antigravityQuotaUrl:
    process.env.ANTIGRAVITY_QUOTA_URL?.trim() ||
    "https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary",

  antigravityOAuth: {
    clientId: process.env.ANTIGRAVITY_OAUTH_CLIENT_ID?.trim() ?? "",
    clientSecret: process.env.ANTIGRAVITY_OAUTH_CLIENT_SECRET?.trim() ?? "",
  },

  agyBin: process.env.AGY_BIN?.trim() || "agy",

  home: process.env.HOME?.trim() || "/data",

  limitsFixture: process.env.LIMITS_FIXTURE?.trim() ?? "",
} as const;
