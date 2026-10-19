import assert from "node:assert/strict";

import {
  AGENT_STATUS_URLS,
} from "../agent-status-parse.ts";
import type { AgentStatusPayload } from "@shared/agent-status-types.ts";

export function summary(body: Record<string, unknown>): string {
  return JSON.stringify({
    status: { indicator: "none", description: "All Systems Operational" },
    components: [],
    incidents: [],
    scheduled_maintenances: [],
    ...body,
  });
}

export const claude = summary({
  status: { indicator: "critical", description: "Major System Outage" },
  components: [
    { name: "claude.ai", status: "major_outage" },
    { name: "Claude Code", status: "operational" },
    { name: "Claude API (api.anthropic.com)", status: "degraded_performance" },
  ],
  incidents: [
    {
      id: "claude-ai",
      name: "claude.ai errors",
      status: "investigating",
      impact: "critical",
      shortlink: "https://status.claude.com/incidents/claude-ai",
      updated_at: "2026-09-22T01:00:00Z",
      components: [{ name: "claude.ai" }],
      incident_updates: [{ body: "claude.ai only", created_at: "2026-09-22T01:00:00Z", status: "investigating" }],
    },
    {
      id: "api",
      name: "Elevated API errors",
      status: "identified",
      impact: "minor",
      shortlink: "https://status.claude.com/incidents/api",
      updated_at: "2026-09-22T02:00:00Z",
      components: [{ name: "Claude API (api.anthropic.com)" }],
      incident_updates: [
        { body: "older", created_at: "2026-09-22T01:00:00Z", status: "investigating" },
        { body: "Error rate is elevated.", created_at: "2026-09-22T02:00:00Z", status: "identified" },
      ],
    },
  ],
});

export const openai = summary({
  components: [
    { name: "Sora", status: "major_outage" },
    { name: "Codex API", status: "operational" },
    { name: "Codex Web", status: "operational" },
    { name: "CLI", status: "partial_outage" },
    { name: "VS Code extension", status: "operational" },
  ],
  incidents: [
    {
      id: "sora",
      name: "Sora down",
      status: "investigating",
      impact: "critical",
      shortlink: "https://status.openai.com/incidents/sora",
      components: [{ name: "Sora" }],
      incident_updates: [{ body: "Sora only", created_at: "2026-09-22T01:00:00Z" }],
    },
  ],
});

export const cursor = summary({
  status: { indicator: "none", description: "All Systems Operational" },
  components: [
    { name: "IDE", status: "operational" },
    { name: "Cloud Agents", status: "under_maintenance" },
  ],
  scheduled_maintenances: [
    {
      id: "maint",
      name: "Cloud Agents upgrade",
      status: "in_progress",
      impact: "maintenance",
      shortlink: "https://status.cursor.com/incidents/maint",
      components: [{ name: "Cloud Agents" }],
      incident_updates: [{ body: "Upgrade in progress.", created_at: "2026-09-22T03:00:00Z" }],
    },
  ],
});

export const xaiHome = `
<a class="card" href="/grok-com"><div class="heading-2">Grok (Web)</div><div class="text-text-success">available</div></a>
<a class="card" href="/grok-build"><div class="heading-2">Grok Build</div><div class="text-text-success">available</div></a>
<a class="card" href="/api-us-east-1"><div class="heading-2">API (us-east-1.api.x.ai)</div><div class="text-text-danger">outage</div></a>
`;

export const xaiFeed = `<?xml version="1.0"?>
<rss><channel>
  <item>
    <title>[API (us-east-1.api.x.ai)] Outages across API, Grok.com, and Grok Build</title>
    <link>https://status.x.ai/api-us-east-1/INC1</link>
    <guid>INC1</guid>
    <pubDate>Tue, 22 Sep 2026 01:02:42 GMT</pubDate>
    <category>disruption</category>
    <description><![CDATA[
      <h3>Status: IDENTIFIED</h3>
      <p>Severity: disruption</p>
      <h3>Mitigation in progress</h3>
      <p>We are investigating a datacenter issue.</p>
    ]]></description>
  </item>
  <item>
    <title>Imagine latency</title>
    <link>https://status.x.ai/imagine/INC2</link>
    <guid>INC2</guid>
    <category>outage</category>
    <category>resolved</category>
    <description><![CDATA[<h3>Status: RESOLVED</h3><p>Severity: outage</p>]]></description>
  </item>
</channel></rss>`;

export function typesafeIndex(options: { page?: string; report?: string; startsAt?: string } = {}): string {
  return JSON.stringify({
    data: {
      id: "238661",
      type: "status_page",
      attributes: { company_name: "Typesafe AI", aggregate_state: options.page ?? "operational" },
    },
    included: [
      {
        id: "8735312",
        type: "status_page_resource",
        attributes: { public_name: "api.typesafe.ai", status: options.page ?? "operational" },
      },
      { id: "8741362", type: "status_page_resource", attributes: { public_name: "console.typesafe.ai", status: "operational" } },
      {
        id: "5814059",
        type: "status_update",
        attributes: { message: "Older note.", published_at: "2026-09-21T23:40:00.000Z" },
      },
      {
        id: "5814060",
        type: "status_update",
        attributes: { message: "We are actively investigating.", published_at: "2026-09-21T23:50:00.000Z" },
      },
      {
        id: "1070670",
        type: "status_report",
        attributes: {
          title: "API issues",
          starts_at: options.startsAt ?? "2026-09-21T23:40:00.000Z",
          ends_at: null,
          aggregate_state: options.report ?? "resolved",
        },
        relationships: {
          status_updates: {
            data: [
              { id: "5814059", type: "status_update" },
              { id: "5814060", type: "status_update" },
            ],
          },
        },
      },
    ],
  });
}

export function appleStatus(events: Record<string, unknown>[] = [], uploadEvents: Record<string, unknown>[] = []): string {
  return `jsonCallback(${JSON.stringify({
    drMessage: null,
    services: [
      { serviceName: "Account", redirectUrl: "https://developer.apple.com/account/", events: [] },
      { serviceName: "Apple Music API", redirectUrl: "https://developer.apple.com/musickit/", events: [] },
      {
        serviceName: "App Store Connect - App Upload",
        redirectUrl: null,
        events: [
          {
            statusType: "Outage",
            eventStatus: "resolved",
            startDate: "09/15/2026 17:28 PDT",
            endDate: "09/15/2026 19:32 PDT",
            usersAffected: "Some users were affected",
            message: "Users may have experienced issues with the service.",
          },
          ...uploadEvents,
        ],
      },
      { serviceName: "Developer ID Notary Service", redirectUrl: " https://developer.apple.com/notary/ ", events },
    ],
  })});`;
}

export const devin = summary({
  status: { indicator: "major", description: "Partial System Outage" },
  components: [
    { name: "Cloud Agent", status: "operational" },
    { name: "Desktop Agent", status: "operational" },
    { name: "Cloud Agent (Enterprise)", status: "major_outage" },
    { name: "Desktop Agent (Fedstart)", status: "major_outage" },
    { name: "Enterprise", status: "major_outage" },
  ],
  incidents: [
    {
      id: "d1",
      name: "Enterprise sessions failing",
      status: "investigating",
      impact: "major",
      shortlink: "https://www.devinstatus.com/incidents/d1",
      components: [{ name: "Cloud Agent (Enterprise)" }],
      incident_updates: [{ body: "Enterprise sessions fail to start.", created_at: "2026-09-22T01:00:00Z" }],
    },
  ],
});

export const github = summary({
  status: { indicator: "minor", description: "Partial System Outage" },
  components: [
    { name: "Git Operations", status: "operational" },
    { name: "Actions", status: "degraded_performance" },
  ],
  incidents: [
    {
      id: "g1",
      name: "Actions delays",
      status: "investigating",
      impact: "minor",
      shortlink: "https://www.githubstatus.com/incidents/g1",
      components: [{ name: "Actions" }],
      incident_updates: [{ body: "Actions runs are delayed.", created_at: "2026-09-22T01:00:00Z" }],
    },
  ],
});

export const cloudflare = summary({
  status: { indicator: "critical", description: "Major Service Outage" },
  components: [
    { name: "CDN/Cache", status: "major_outage" },
    { name: "Workers", status: "operational" },
    { name: "Workers AI", status: "major_outage" },
    { name: "Authoritative DNS", status: "operational" },
    { name: "Africa", status: "partial_outage" },
  ],
  incidents: [
    {
      id: "warp-geo",
      name: "Incorrect geo location for some Cloudflare WARP users",
      status: "identified",
      impact: "critical",
      shortlink: "https://www.cloudflarestatus.com/incidents/warp-geo",
      components: [{ name: "WARP" }, { name: "Cloudflare Sites and Services" }],
      incident_updates: [{ body: "A fix is being rolled out.", created_at: "2026-09-22T01:00:00Z" }],
    },
  ],
});

export function pages(extra: Record<string, string | Error> = {}): (url: string) => Promise<string> {
  const bodies = new Map<string, string | Error>([
    [AGENT_STATUS_URLS.claude, claude],
    [AGENT_STATUS_URLS.openai, openai],
    [AGENT_STATUS_URLS.cursor, cursor],
    [AGENT_STATUS_URLS.xaiHome, xaiHome],
    [AGENT_STATUS_URLS.xaiFeed, xaiFeed],
    [AGENT_STATUS_URLS.typesafe, typesafeIndex()],
    [AGENT_STATUS_URLS.devin, devin],
    [AGENT_STATUS_URLS.apple, appleStatus()],
    [AGENT_STATUS_URLS.github, github],
    [AGENT_STATUS_URLS.cloudflare, cloudflare],
  ]);
  for (const [url, body] of Object.entries(extra)) bodies.set(url, body);
  return async (url) => {
    const body = bodies.get(url);
    if (body instanceof Error) throw body;
    if (body == null) throw new Error(`missing ${url}`);
    return body;
  };
}

export function row(payload: AgentStatusPayload, id: AgentStatusPayload["agents"][number]["id"]) {
  const agent = payload.agents.find((item) => item.id === id);
  assert.ok(agent, id);
  return agent;
}
