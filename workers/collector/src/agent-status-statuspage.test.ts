import assert from "node:assert/strict";
import test from "node:test";

import {
  AGENT_STATUS_URLS,
  collectAgentStatus,
} from "./agent-status-parse.ts";
import { pages, row, summary } from "./testing/agent-status-pages.ts";

test("Devin 只看公开版组件，Enterprise / Fedstart 出事不点这一行", async () => {
  const payload = await collectAgentStatus(null, pages());
  const devinRow = row(payload, "devin");
  assert.equal(devinRow.indicator, "operational");
  assert.deepEqual(
    devinRow.components.map((component) => component.name),
    ["Cloud Agent", "Desktop Agent"],
  );
  assert.equal(devinRow.incidents.length, 0);
});

test("GitHub 走 Statuspage 整页，页面灯直接进这一行", async () => {
  const payload = await collectAgentStatus(null, pages());
  const githubRow = row(payload, "github");
  assert.equal(githubRow.indicator, "degraded");
  assert.equal(githubRow.incidents[0]?.title, "Actions delays");
  assert.ok(githubRow.components.some((component) => component.name === "Actions"));
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

test("整页来源的总灯是 minor 时，事件自标 major 也不把 Cursor 抬成部分中断", async () => {
  const body = summary({
    status: { indicator: "minor", description: "Minor Service Outage" },
    components: [
      { name: "IDE", status: "operational" },
      { name: "Cloud Agents", status: "partial_outage" },
    ],
    incidents: [
      {
        id: "multi",
        name: "Multiple services degraded",
        status: "investigating",
        impact: "major",
        shortlink: "https://status.cursor.com/incidents/multi",
        components: [{ name: "Cloud Agents" }],
        incident_updates: [{ body: "Investigating.", created_at: "2026-10-28T21:39:00Z" }],
      },
    ],
  });
  const payload = await collectAgentStatus(null, pages({ [AGENT_STATUS_URLS.cursor]: body }));
  const cursorRow = row(payload, "cursor");
  assert.equal(cursorRow.indicator, "degraded");
  assert.equal(cursorRow.incidents[0]?.id, "multi");
});
