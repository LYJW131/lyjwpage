import type { AgentStatusPayload, AgentStatusRow } from "@shared/agent-status-types";
import { appleRow } from "./agent-status-apple";
import { STATUS_PAGES } from "./agent-status-format";
import {
  CLOUDFLARE_SITE_COMPONENTS,
  isClaudeComponent,
  isCodexComponent,
  isDevinComponent,
  statuspageRow,
} from "./agent-status-statuspage";
import { typesafeRow } from "./agent-status-typesafe";
import { xaiRow } from "./agent-status-xai";

export { parseAppleStatus } from "./agent-status-apple";
export { parseXaiFeed, parseXaiServiceBadges } from "./agent-status-xai";

export const AGENT_STATUS_URLS = {
  claude: "https://status.claude.com/api/v2/summary.json",
  openai: "https://status.openai.com/api/v2/summary.json",
  cursor: "https://status.cursor.com/api/v2/summary.json",
  xaiHome: "https://status.x.ai/",
  xaiFeed: "https://status.x.ai/feed.xml",
  typesafe: "https://status.typesafe.ai/index.json",
  devin: "https://www.devinstatus.com/api/v2/summary.json",
  apple: "https://www.apple.com/support/systemstatus/data/developer/system_status_en_US.js",
  github: "https://www.githubstatus.com/api/v2/summary.json",
  cloudflare: "https://www.cloudflarestatus.com/api/v2/summary.json",
} as const;

type FetchText = (url: string) => Promise<string>;

const FALLBACK: Record<AgentStatusRow["id"], { name: string; statusPage: string }> = {
  claude: { name: "Claude", statusPage: STATUS_PAGES.claude },
  codex: { name: "ChatGPT", statusPage: STATUS_PAGES.openai },
  cursor: { name: "Cursor", statusPage: STATUS_PAGES.cursor },
  grok: { name: "Grok", statusPage: STATUS_PAGES.xai },
  typesafe: { name: "TypeSafe", statusPage: STATUS_PAGES.typesafe },
  devin: { name: "Devin", statusPage: STATUS_PAGES.devin },
  apple: { name: "Apple", statusPage: STATUS_PAGES.apple },
  github: { name: "GitHub", statusPage: STATUS_PAGES.github },
  cloudflare: { name: "Cloudflare", statusPage: STATUS_PAGES.cloudflare },
};

function carried(previous: AgentStatusPayload | null, id: AgentStatusRow["id"], failure: string): AgentStatusRow {
  const prior = previous?.agents.find((agent) => agent.id === id);
  if (prior) return { ...prior, stale: true };
  const fallback = FALLBACK[id];
  return {
    id,
    name: fallback.name,
    indicator: "unavailable",
    statusUrl: fallback.statusPage,
    components: [],
    incidents: [],
    note: failure,
    stale: false,
  };
}

async function load(
  previous: AgentStatusPayload | null,
  failed: Set<AgentStatusRow["id"]>,
  id: AgentStatusRow["id"],
  run: () => Promise<AgentStatusRow>,
): Promise<AgentStatusRow> {
  try {
    return await run();
  } catch (error) {
    console.warn(
      "[agent-status]",
      id,
      error instanceof Error ? error.message : String(error),
    );
    failed.add(id);
    return carried(previous, id, "Status check failed.");
  }
}

export async function collectAgentStatus(
  previous: AgentStatusPayload | null,
  fetchText: FetchText,
  now = Date.now(),
): Promise<AgentStatusPayload> {
  const text = async (url: string) => fetchText(url);
  const failed = new Set<AgentStatusRow["id"]>();
  const [claude, codex, cursor, grok, typesafe, devin, apple, github, cloudflare] = await Promise.all([
    load(previous, failed, "claude", async () =>
      statuspageRow(
        "claude",
        "Claude",
        STATUS_PAGES.claude,
        await text(AGENT_STATUS_URLS.claude),
        isClaudeComponent,
        false,
      ),
    ),
    load(previous, failed, "codex", async () =>
      statuspageRow(
        "codex",
        "ChatGPT",
        STATUS_PAGES.openai,
        await text(AGENT_STATUS_URLS.openai),
        isCodexComponent,
        false,
      ),
    ),
    load(previous, failed, "cursor", async () =>
      statuspageRow("cursor", "Cursor", STATUS_PAGES.cursor, await text(AGENT_STATUS_URLS.cursor), () => true, true),
    ),
    load(previous, failed, "grok", async () => {
      const [home, feed] = await Promise.all([
        text(AGENT_STATUS_URLS.xaiHome).then(
          (body) => ({ ok: true as const, body }),
          () => ({ ok: false as const, body: null }),
        ),
        text(AGENT_STATUS_URLS.xaiFeed).then(
          (body) => ({ ok: true as const, body }),
          () => ({ ok: false as const, body: null }),
        ),
      ]);
      if (!home.ok && !feed.ok) throw new Error("status.x.ai unreachable");
      return xaiRow(home.body, feed.body);
    }),
    load(previous, failed, "typesafe", async () => typesafeRow(await text(AGENT_STATUS_URLS.typesafe), now)),
    load(previous, failed, "devin", async () =>
      statuspageRow(
        "devin",
        "Devin",
        STATUS_PAGES.devin,
        await text(AGENT_STATUS_URLS.devin),
        isDevinComponent,
        false,
      ),
    ),
    load(previous, failed, "apple", async () => appleRow(await text(AGENT_STATUS_URLS.apple))),
    load(previous, failed, "github", async () =>
      statuspageRow(
        "github",
        "GitHub",
        STATUS_PAGES.github,
        await text(AGENT_STATUS_URLS.github),
        () => true,
        true,
      ),
    ),
    load(previous, failed, "cloudflare", async () =>
      statuspageRow(
        "cloudflare",
        "Cloudflare",
        STATUS_PAGES.cloudflare,
        await text(AGENT_STATUS_URLS.cloudflare),
        (name) => name.trim().toLowerCase() in CLOUDFLARE_SITE_COMPONENTS,
        false,
      ),
    ),
  ]);
  if (failed.size === Object.keys(FALLBACK).length) throw new Error("status pages all unreachable");
  return {
    fetchedAt: now,
    agents: [claude, codex, cursor, grok, typesafe, devin, apple, github, cloudflare],
  };
}

export function agentStatusFingerprint(payload: AgentStatusPayload | null): string {
  if (!payload) return "";
  return JSON.stringify(payload.agents.map((agent) => [agent.id, agent.indicator]));
}
