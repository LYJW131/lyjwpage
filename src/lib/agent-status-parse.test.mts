import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_STATUS_URLS,
  agentStatusFingerprint,
  collectAgentStatus,
  parseXaiFeed,
  parseXaiServiceBadges,
} from "./agent-status-parse.ts";
import type { AgentStatusPayload } from "./agent-status-types.ts";

function summary(body: Record<string, unknown>): string {
  return JSON.stringify({
    status: { indicator: "none", description: "All Systems Operational" },
    components: [],
    incidents: [],
    scheduled_maintenances: [],
    ...body,
  });
}

const claude = summary({
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

const openai = summary({
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

const cursor = summary({
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

const xaiHome = `
<a class="card" href="/grok-com"><div class="heading-2">Grok (Web)</div><div class="text-text-success">available</div></a>
<a class="card" href="/grok-build"><div class="heading-2">Grok Build</div><div class="text-text-success">available</div></a>
<a class="card" href="/api-us-east-1"><div class="heading-2">API (us-east-1.api.x.ai)</div><div class="text-text-danger">outage</div></a>
`;

const xaiFeed = `<?xml version="1.0"?>
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

function pages(extra: Record<string, string | Error> = {}): (url: string) => Promise<string> {
  const bodies = new Map<string, string | Error>([
    [AGENT_STATUS_URLS.claude, claude],
    [AGENT_STATUS_URLS.openai, openai],
    [AGENT_STATUS_URLS.cursor, cursor],
    [AGENT_STATUS_URLS.xaiHome, xaiHome],
    [AGENT_STATUS_URLS.xaiFeed, xaiFeed],
  ]);
  for (const [url, body] of Object.entries(extra)) bodies.set(url, body);
  return async (url) => {
    const body = bodies.get(url);
    if (body instanceof Error) throw body;
    if (body == null) throw new Error(`missing ${url}`);
    return body;
  };
}

function row(payload: AgentStatusPayload, id: AgentStatusPayload["agents"][number]["id"]) {
  const agent = payload.agents.find((item) => item.id === id);
  assert.ok(agent, id);
  return agent;
}

test("Claude 只看 Code 和 API，不跟 claude.ai 的全站故障走", async () => {
  const payload = await collectAgentStatus(null, pages());
  const claudeRow = row(payload, "claude");
  assert.equal(claudeRow.indicator, "degraded");
  assert.deepEqual(
    claudeRow.components.map((component) => component.name),
    ["Claude Code", "Claude API (api.anthropic.com)"],
  );
  assert.deepEqual(
    claudeRow.incidents.map((incident) => incident.id),
    ["api"],
  );
  assert.equal(claudeRow.incidents[0]?.body, "Error rate is elevated.");
  assert.equal(claudeRow.stale, false);
});

test("Codex 忽略 Sora，CLI 掉了就算部分中断", async () => {
  const payload = await collectAgentStatus(null, pages());
  const codex = row(payload, "codex");
  assert.equal(codex.indicator, "partial_outage");
  assert.equal(codex.incidents.length, 0);
  assert.ok(codex.components.some((component) => component.name === "CLI"));
  assert.equal(codex.components.some((component) => component.name === "Sora"), false);
});

test("Cursor 用整页：维护中的组件把这一行标成 Maintenance", async () => {
  const payload = await collectAgentStatus(null, pages());
  const cursorRow = row(payload, "cursor");
  assert.equal(cursorRow.indicator, "maintenance");
  assert.equal(cursorRow.incidents[0]?.title, "Cloud Agents upgrade");
  assert.equal(cursorRow.incidents[0]?.status, "In progress");
});

test("页面灯是 critical 但组件都正常时，Cursor 仍跟着页面灯", async () => {
  const body = summary({
    status: { indicator: "critical", description: "Major System Outage" },
    components: [{ name: "IDE", status: "operational" }],
  });
  const payload = await collectAgentStatus(null, pages({ [AGENT_STATUS_URLS.cursor]: body }));
  assert.equal(row(payload, "cursor").indicator, "major_outage");
});

test("xAI 首页灯是 available，未结束且点名 Grok Build 的事件把它拉成降级", async () => {
  const badges = parseXaiServiceBadges(xaiHome);
  assert.deepEqual(
    badges.map((badge) => [badge.href, badge.badge]),
    [
      ["/grok-com", "available"],
      ["/grok-build", "available"],
      ["/api-us-east-1", "outage"],
    ],
  );
  const items = parseXaiFeed(xaiFeed);
  assert.equal(items[0]?.status, "Identified");
  assert.equal(items[1]?.status, "resolved");

  const payload = await collectAgentStatus(null, pages());
  const grok = row(payload, "grok");
  assert.equal(grok.indicator, "degraded");
  assert.equal(grok.components[0]?.indicator, "operational");
  assert.equal(grok.incidents.length, 1);
  assert.match(grok.incidents[0]?.title ?? "", /Grok Build/);
  assert.equal(grok.incidents[0]?.body, "We are investigating a datacenter issue.");
});

test("首页被拦时，feed 里没有未结束的 Grok Build 事件就按正常", async () => {
  const feed = xaiFeed
    .replace("<category>disruption</category>", "<category>disruption</category><category>resolved</category>")
    .replace("Status: IDENTIFIED", "Status: RESOLVED");
  const payload = await collectAgentStatus(null, pages({
    [AGENT_STATUS_URLS.xaiHome]: new Error("403 status.x.ai"),
    [AGENT_STATUS_URLS.xaiFeed]: feed,
  }));
  const grok = row(payload, "grok");
  assert.equal(grok.indicator, "operational");
  assert.equal(grok.incidents.length, 0);
  assert.equal(grok.note, null);
  assert.equal(grok.stale, false);
});

test("Grok Build 自己的灯是 outage 时，已解决的 feed 不把它刷回正常", async () => {
  const home = xaiHome.replace('href="/grok-build"><div class="heading-2">Grok Build</div><div class="text-text-success">available', 'href="/grok-build"><div class="heading-2">Grok Build</div><div class="text-text-danger">outage');
  const feed = xaiFeed.replace("<category>disruption</category>", "<category>disruption</category><category>resolved</category>").replace("Status: IDENTIFIED", "Status: RESOLVED");
  const payload = await collectAgentStatus(null, pages({
    [AGENT_STATUS_URLS.xaiHome]: home,
    [AGENT_STATUS_URLS.xaiFeed]: feed,
  }));
  const grok = row(payload, "grok");
  assert.equal(grok.indicator, "major_outage");
  assert.equal(grok.incidents.length, 0);
});

test("Antigravity 没有状态页，不假装成正常", async () => {
  const payload = await collectAgentStatus(null, pages());
  const antigravity = row(payload, "antigravity");
  assert.equal(antigravity.indicator, "unmonitored");
  assert.match(antigravity.statusUrl, /aistudio\.google\.com\/status$/);
  assert.match(antigravity.note ?? "", /doesn't publish/);
});

test("一家失败时留着上一轮，其它家照常更新", async () => {
  const first = await collectAgentStatus(null, pages(), 1_000);
  const second = await collectAgentStatus(first, pages({
    [AGENT_STATUS_URLS.openai]: new Error("timeout"),
  }), 2_000);
  assert.equal(row(second, "codex").stale, true);
  assert.equal(row(second, "codex").indicator, "partial_outage");
  assert.equal(row(second, "claude").stale, false);
  assert.equal(second.fetchedAt, 2_000);
  assert.equal(agentStatusFingerprint(first) === agentStatusFingerprint({ ...first, fetchedAt: 9_000 }), true);
  assert.notEqual(agentStatusFingerprint(first), agentStatusFingerprint(second));
});

test("状态页不再列出盯着的组件时，不退回整页灯", async () => {
  const body = summary({
    status: { indicator: "none" },
    components: [{ name: "Sora", status: "operational" }],
  });
  const payload = await collectAgentStatus(null, pages({ [AGENT_STATUS_URLS.openai]: body }));
  const codex = row(payload, "codex");
  assert.equal(codex.indicator, "unavailable");
  assert.match(codex.note ?? "", /no longer lists/);
});
