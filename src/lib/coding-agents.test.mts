import assert from "node:assert/strict";
import test from "node:test";

import {
  codingAgentBrand,
  codingAgentRows,
  codingDisplayModel,
  codingSourceHealth,
  describeCodingSources,
  liveCodingActivity,
  type CodingActivityEntry,
} from "./coding-agents.ts";
import type { CodingUsageAgentView } from "./types.ts";

const limitRow = { plan: null, limits: [], limitsError: null, updatedAt: 5_000 };

function usageAgent(id: string, extra: Partial<CodingUsageAgentView> = {}): CodingUsageAgentView {
  return {
    id,
    sources: ["mac"],
    models: [],
    latestModel: null,
    lastDay: null,
    status: [{ source: "mac", state: "ok", collectedAt: 1_000, error: null, warning: null }],
    ...extra,
  };
}

test("登记表：展示名、图标、行的种类；没登记的 id 用 id 当名字、占紧凑行", () => {
  assert.deepEqual(codingAgentBrand("grok"), { label: "Grok Build", icon: "grok", row: "compact" });
  assert.equal(codingAgentBrand("opencode").row, "hidden");
  assert.deepEqual(codingAgentBrand("newagent"), { label: "newagent", icon: "newagent", row: "compact" });
  assert.equal(codingAgentBrand("constructor").label, "constructor");
});

test("行：三份按 id 并起来，只在一份里出现的也有一行，缺的那份如实为空；登记的按登记顺序在前", () => {
  const rows = codingAgentRows(
    { agents: [usageAgent("zeta"), usageAgent("codex"), usageAgent("claude")] },
    { agents: [{ id: "cursor", activity: [{ source: "agents", lastActivityAt: 2_000, model: "composer-2" }] }] },
    { agents: { grok: limitRow, claude: { ...limitRow, updatedAt: 6_000 } } },
  );
  assert.deepEqual(rows.map((row) => row.id), ["claude", "cursor", "codex", "grok", "zeta"]);
  const [claude, cursor, , grok] = rows;
  assert.equal(claude?.limitsAt, 6_000);
  assert.equal(claude?.usage?.id, "claude");
  assert.deepEqual(claude?.activity, []);
  assert.equal(cursor?.usage, null);
  assert.equal(cursor?.limitsAt, null);
  assert.equal(cursor?.row, "featured");
  assert.equal(grok?.label, "Grok Build");
  assert.equal(grok?.usage, null);
  assert.deepEqual(codingAgentRows(null, null, null), []);
});

test("行：各来源的活动按时刻降序，不信推来的顺序", () => {
  const [claude] = codingAgentRows(null, {
    agents: [{
      id: "claude",
      activity: [
        { source: "mac", lastActivityAt: 1_000, model: "claude-opus-5" },
        { source: "agents-otlp", lastActivityAt: 3_000, model: "claude-sonnet-5" },
      ],
    }],
  }, null);
  assert.deepEqual(claude?.activity.map((entry) => entry.source), ["agents-otlp", "mac"]);
});

test("活动灯：取最新一条；Mac 亲口离线时只作废来自 mac 的时刻，云端和账号照样算", () => {
  const activity: CodingActivityEntry[] = [
    { source: "mac", lastActivityAt: 9_000, model: "claude-opus-5" },
    { source: "agents-otlp", lastActivityAt: 8_000, model: "claude-sonnet-5" },
  ];
  assert.equal(liveCodingActivity(activity, false)?.source, "mac");
  assert.equal(liveCodingActivity(activity, true)?.source, "agents-otlp");
  assert.equal(liveCodingActivity([activity[0]!], true), null);
  assert.equal(liveCodingActivity([], false), null);
});

test("模型名：亮着就是亮着那条的；灭了取最近一条带模型的事件；都没有用视图里的最近主力模型", () => {
  const row = {
    usage: usageAgent("claude", { latestModel: "claude-haiku-5" }),
    activity: [
      { source: "mac", lastActivityAt: 9_000, model: null },
      { source: "agents-otlp", lastActivityAt: 8_000, model: "claude-sonnet-5" },
    ] satisfies CodingActivityEntry[],
  };
  const live = row.activity[1]!;
  assert.equal(codingDisplayModel(row, live, true), "claude-sonnet-5");
  assert.equal(codingDisplayModel(row, row.activity[0]!, false), "claude-sonnet-5");
  assert.equal(codingDisplayModel({ usage: row.usage, activity: [] }, null, false), "claude-haiku-5");
  assert.equal(codingDisplayModel({ usage: null, activity: [] }, null, false), null);
});

test("来源状况：只有参与合计的来源采集失败才算缺；被账号覆盖的不算缺，但写进说明", () => {
  const usage = usageAgent("cursor", {
    sources: ["agents"],
    status: [
      { source: "mac", state: "superseded", collectedAt: 1_000, error: null, warning: null },
      { source: "agents", state: "error", collectedAt: 900, error: "401 Unauthorized", warning: null },
    ],
  });
  const { failing, notes } = codingSourceHealth(usage);
  assert.deepEqual(failing.map((note) => note.label), ["Account"]);
  assert.equal(describeCodingSources(notes), "Mac: covered by Account\nAccount: failed to update — 401 Unauthorized");

  const healthy = codingSourceHealth(usageAgent("claude", {
    sources: ["mac", "agents-otlp"],
    status: [
      { source: "mac", state: "ok", collectedAt: 1_000, error: null, warning: "token 未分列" },
      { source: "agents-otlp", state: "ok", collectedAt: 1_000, error: null, warning: null },
    ],
  }));
  assert.deepEqual(healthy.failing, []);
  assert.equal(describeCodingSources(healthy.notes), "Mac: counted (token 未分列)\nCloud: counted");
  assert.deepEqual(codingSourceHealth(null), { failing: [], notes: [] });
});
