import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_STATUS_URLS,
  agentStatusFingerprint,
  collectAgentStatus,
  parseXaiFeed,
  parseXaiServiceBadges,
  parseDeepseekFeed,
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

const deepseekFeed = `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom">
  <title>DeepSeek</title>
  <entry>
    <title>DeepSeek 网页/API 部分中断（DeepSeek Web/API Partially Unavailable）</title>
    <updated>2026-09-22T01:00:00+08:00</updated>
    <id>urn:flashduty:change:1</id>
    <link href="https://status.deepseek.com/incidents/1" rel="alternate"></link>
    <summary type="html">&lt;p&gt;&lt;strong&gt;Status:&lt;/strong&gt; investigating&lt;/p&gt;&lt;p&gt;我们正在抢修。&#xA;&#xA;We are working on it.&lt;/p&gt;&lt;p&gt;&lt;strong&gt;Affected components:&lt;/strong&gt; 对话服务(Chatservice), DeepSeek V4.1 Flash API服务(API Service)&lt;/p&gt;</summary>
  </entry>
  <entry>
    <title>DeepSeek API 性能下降（DeepSeek API Degraded Performance）</title>
    <updated>2026-08-01T10:00:00+08:00</updated>
    <id>urn:flashduty:change:2</id>
    <link href="https://status.deepseek.com/incidents/2" rel="alternate"></link>
    <summary type="html">&lt;p&gt;&lt;strong&gt;Status:&lt;/strong&gt; resolved&lt;/p&gt;&lt;p&gt;本次问题已解决，服务已恢复。&lt;/p&gt;&lt;p&gt;&lt;strong&gt;Affected components:&lt;/strong&gt; DeepSeek V4.1 Flash API服务(API Service)&lt;/p&gt;</summary>
  </entry>
</feed>`;

const deepseekResolved = deepseekFeed.replace(
  "Status:&lt;/strong&gt; investigating",
  "Status:&lt;/strong&gt; resolved",
);

const vercel = summary({
  status: { indicator: "minor", description: "Partial System Outage" },
  components: [{ name: "Builds", status: "degraded_performance" }],
  incidents: [
    {
      id: "v1",
      name: "Build delays",
      status: "investigating",
      impact: "minor",
      shortlink: "https://www.vercelstatus.com/incidents/v1",
      components: [{ name: "Builds" }],
      incident_updates: [{ body: "Builds are delayed.", created_at: "2026-09-22T01:00:00Z" }],
    },
  ],
});

const github = summary({
  status: { indicator: "none", description: "All Systems Operational" },
  components: [{ name: "Git Operations", status: "operational" }],
});

const cloudflare = summary({
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

function pages(extra: Record<string, string | Error> = {}): (url: string) => Promise<string> {
  const bodies = new Map<string, string | Error>([
    [AGENT_STATUS_URLS.claude, claude],
    [AGENT_STATUS_URLS.openai, openai],
    [AGENT_STATUS_URLS.cursor, cursor],
    [AGENT_STATUS_URLS.xaiHome, xaiHome],
    [AGENT_STATUS_URLS.xaiFeed, xaiFeed],
    [AGENT_STATUS_URLS.deepseekFeed, deepseekResolved],
    [AGENT_STATUS_URLS.vercel, vercel],
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

function row(payload: AgentStatusPayload, id: AgentStatusPayload["agents"][number]["id"]) {
  const agent = payload.agents.find((item) => item.id === id);
  assert.ok(agent, id);
  return agent;
}

test("DeepSeek 的灯按未结束事件走，受影响组件从摘要里读", async () => {
  const items = parseDeepseekFeed(deepseekFeed);
  assert.equal(items.length, 2);
  assert.equal(items[0]?.resolved, false);
  assert.equal(items[0]?.severity, "partial_outage");
  assert.equal(items[0]?.url, "https://status.deepseek.com/incidents/1");
  assert.deepEqual(items[0]?.componentNames, ["对话服务(Chatservice)", "DeepSeek V4.1 Flash API服务(API Service)"]);
  assert.equal(items[1]?.resolved, true);

  const payload = await collectAgentStatus(null, pages({ [AGENT_STATUS_URLS.deepseekFeed]: deepseekFeed }));
  const deepseek = row(payload, "deepseek");
  assert.equal(deepseek.indicator, "partial_outage");
  assert.equal(deepseek.incidents.length, 1);
  assert.equal(deepseek.incidents[0]?.status, "Investigating");
  assert.equal(deepseek.incidents[0]?.body, "我们正在抢修。 We are working on it.");
  assert.deepEqual(
    deepseek.components.map((component) => component.name),
    ["对话服务(Chatservice)", "DeepSeek V4.1 Flash API服务(API Service)"],
  );
});

test("DeepSeek 全部 resolved 就是 Operational，事件列表空", async () => {
  const payload = await collectAgentStatus(null, pages());
  const deepseek = row(payload, "deepseek");
  assert.equal(deepseek.indicator, "operational");
  assert.equal(deepseek.incidents.length, 0);
  assert.equal(deepseek.note, null);
});

test("Vercel / GitHub 走 Statuspage 整页，页面灯直接进这一行", async () => {
  const payload = await collectAgentStatus(null, pages());
  const vercelRow = row(payload, "vercel");
  assert.equal(vercelRow.indicator, "degraded");
  assert.equal(vercelRow.incidents[0]?.title, "Build delays");
  assert.ok(vercelRow.components.some((component) => component.name === "Builds"));
  assert.equal(row(payload, "github").indicator, "operational");
});

test("Cloudflare 只盯站点用到的产品和 DNS，不跟整页灯、机房或 WARP 走", async () => {
  const payload = await collectAgentStatus(null, pages());
  const cloudflareRow = row(payload, "cloudflare");
  assert.equal(cloudflareRow.indicator, "operational");
  assert.equal(cloudflareRow.incidents.length, 0);
  assert.deepEqual(
    cloudflareRow.components.map((component) => component.name),
    ["Workers", "Authoritative DNS"],
  );
});

test("Cloudflare 的灯跟盯着的组件和点名它们的事件走", async () => {
  const body = summary({
    status: { indicator: "none", description: "All Systems Operational" },
    components: [
      { name: "Workers", status: "partial_outage" },
      { name: "Authoritative DNS", status: "degraded_performance" },
      { name: "DNS Updates", status: "operational" },
      { name: "Bot Management", status: "major_outage" },
      { name: "Baghdad, Iraq - (BGW)", status: "under_maintenance" },
    ],
    incidents: [
      {
        id: "workers",
        name: "Workers elevated errors",
        status: "investigating",
        impact: "major",
        shortlink: "https://www.cloudflarestatus.com/incidents/workers",
        components: [{ name: "Workers" }],
        incident_updates: [{ body: "Error rate is elevated.", created_at: "2026-09-22T02:00:00Z" }],
      },
      {
        id: "bots",
        name: "Bot Management delays",
        status: "investigating",
        impact: "critical",
        shortlink: "https://www.cloudflarestatus.com/incidents/bots",
        components: [{ name: "Bot Management" }],
        incident_updates: [{ body: "Unrelated.", created_at: "2026-09-22T02:00:00Z" }],
      },
    ],
  });
  const payload = await collectAgentStatus(null, pages({ [AGENT_STATUS_URLS.cloudflare]: body }));
  const cloudflareRow = row(payload, "cloudflare");
  assert.equal(cloudflareRow.indicator, "partial_outage");
  assert.deepEqual(
    cloudflareRow.incidents.map((incident) => incident.id),
    ["workers"],
  );
  assert.equal(
    cloudflareRow.components.some((component) => component.name === "Bot Management"),
    false,
  );
});

test("Cloudflare 状态页不再列出盯着的产品时，不退回整页灯", async () => {
  const body = summary({
    status: { indicator: "critical", description: "Major Service Outage" },
    components: [
      { name: "WARP", status: "major_outage" },
      { name: "Africa", status: "partial_outage" },
    ],
  });
  const payload = await collectAgentStatus(null, pages({ [AGENT_STATUS_URLS.cloudflare]: body }));
  const cloudflareRow = row(payload, "cloudflare");
  assert.equal(cloudflareRow.indicator, "unavailable");
  assert.match(cloudflareRow.note ?? "", /no longer lists/);
  assert.equal(cloudflareRow.incidents.length, 0);
});

test("DeepSeek 的 feed 读不出来时这一行是 Unavailable 并留说明", async () => {
  const payload = await collectAgentStatus(
    null,
    pages({ [AGENT_STATUS_URLS.deepseekFeed]: "<html>maintenance page</html>" }),
  );
  const deepseek = row(payload, "deepseek");
  assert.equal(deepseek.indicator, "unavailable");
  assert.match(deepseek.note ?? "", /could not be read/);
});

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

test("HTML 实体只解一层，双重编码不会再被解开", () => {
  const feed = `<?xml version="1.0"?>
<rss><channel>
  <item>
    <title>Grok Build</title>
    <link>https://status.x.ai/grok-build/INC3</link>
    <guid>INC3</guid>
    <category>disruption</category>
    <description><![CDATA[
      <h3>Status: IDENTIFIED</h3>
      <p>Severity: disruption</p>
      <h3>Update</h3>
      <p>Tom &amp;amp; Jerry saw &amp;lt;build&amp;gt; &#39;ok&#39; &#x26;lt;script&amp;gt;</p>
    ]]></description>
  </item>
</channel></rss>`;
  const items = parseXaiFeed(feed);
  assert.equal(items[0]?.body, "Tom &amp; Jerry saw &lt;build&gt; 'ok' &lt;script&gt;");
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
