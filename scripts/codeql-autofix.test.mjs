import assert from "node:assert/strict";
import test from "node:test";
import { alertBranch, buildAlertPrompt, renderSummary, runCodeqlAutofix, sortAlerts } from "./codeql-autofix.mjs";
import { HttpError, parseModel } from "./cursor-cloud.mjs";

const REPO = "LYJW131/lyjwpage";

const alert = (number, rule = {}, path = "src/a.ts") => ({
  number,
  html_url: `https://github.com/${REPO}/security/code-scanning/${number}`,
  rule: { id: `js/rule-${number}`, description: `Rule ${number}`, severity: "warning", ...rule },
  most_recent_instance: { message: { text: `message ${number}` }, location: { path, start_line: 3, end_line: 5 } },
});

function fakeGithub(alerts, { existing = [], createError } = {}) {
  const calls = { created: [], deleted: [] };
  const branches = new Map([["main", "base-sha"], ...existing.map((name) => [name, "x"])]);
  return {
    calls,
    listOpenAlerts: async () => alerts,
    branchSha: async (name) => branches.get(name) ?? null,
    createBranch: async (name, sha) => {
      if (createError) throw createError;
      calls.created.push({ name, sha });
      branches.set(name, sha);
    },
    deleteBranch: async (name) => calls.deleted.push(name),
  };
}

function fakeCursor(runsByAgent, { failCreate = () => false } = {}) {
  const calls = { create: [], cancel: [] };
  let n = 0;
  return {
    calls,
    createAgent: async (body) => {
      calls.create.push(body);
      if (failCreate(body)) throw new HttpError("Cursor", "POST", "/v1/agents", 400, "bad");
      n += 1;
      const id = `bc-${n}`;
      return { agent: { id, url: `https://cursor.com/agents/${id}` }, run: { id: `run-${n}`, status: "CREATING" } };
    },
    getRun: async (agentId) => {
      const queue = runsByAgent[agentId] ?? [{ status: "RUNNING" }];
      return queue.length > 1 ? queue.shift() : queue[0];
    },
    cancelRun: async (agentId) => calls.cancel.push(agentId),
  };
}

const quiet = { log() {}, warn() {} };
const noSleep = async () => {};
const MODEL = "grok-4.7 reasoning_effort=xhigh fast=true";

test("告警按安全等级、严重度、编号排序", () => {
  const sorted = sortAlerts([
    alert(4, { severity: "note" }),
    alert(3, { security_severity_level: "medium" }),
    alert(2, { severity: "error" }),
    alert(1, { security_severity_level: "high" }),
  ]);
  assert.deepEqual(sorted.map((a) => a.number), [1, 3, 2, 4]);
});

test("提示词带上规则、位置与不准压制告警的约束", () => {
  const prompt = buildAlertPrompt({ repo: REPO, alert: alert(7, { help: "# Help\nUse a safe API." }), branch: alertBranch(alert(7)), baseRef: "main" });
  assert.match(prompt, /alert #7/);
  assert.match(prompt, /`js\/rule-7` — Rule 7 \(severity warning\)/);
  assert.match(prompt, /`src\/a.ts` lines 3-5/);
  assert.match(prompt, /`codeql-fix\/alert-7`, created from `main`/);
  assert.match(prompt, /Use a safe API\./);
  assert.match(prompt, /no suppression comments/);
});

test("每条告警一个分支一个 agent，已派过的跳过，超出上限的顺延", async () => {
  const github = fakeGithub([alert(1), alert(2), alert(3), alert(4)], { existing: ["codeql-fix/alert-2"] });
  const cursor = fakeCursor({
    "bc-1": [{ status: "RUNNING" }, { status: "FINISHED" }, { status: "FINISHED", git: { branches: [{ branch: "codeql-fix/alert-1", prUrl: "https://github.com/pr/11" }] } }],
    "bc-2": [{ status: "FINISHED", result: "False positive: input is a constant." }],
  });
  const { items, code } = await runCodeqlAutofix({ repo: REPO, baseRef: "main", github, cursor, model: MODEL, limit: 2, log: quiet, sleep: noSleep });

  assert.equal(code, 0);
  assert.deepEqual(github.calls.created, [{ name: "codeql-fix/alert-1", sha: "base-sha" }, { name: "codeql-fix/alert-3", sha: "base-sha" }]);
  const [first] = cursor.calls.create;
  assert.deepEqual(first.repos, [{ url: `https://github.com/${REPO}`, startingRef: "codeql-fix/alert-1" }]);
  assert.equal(first.workOnCurrentBranch, true);
  assert.equal(first.autoCreatePR, true);
  assert.deepEqual(first.model, parseModel(MODEL));
  assert.deepEqual(
    items.map((item) => [item.alert.number, item.outcome, item.prUrl]),
    [[1, "pr opened", "https://github.com/pr/11"], [2, "already attempted", undefined], [3, "no change", undefined], [4, "deferred", undefined]],
  );

  const summary = renderSummary({ items });
  assert.match(summary, /\| \[#1\]\(.+\) \| `js\/rule-1` \| `src\/a.ts` lines 3-5 \| pr opened \| \[PR\]\(https:\/\/github.com\/pr\/11\) · \[agent\]/);
  assert.match(summary, /\*\*#3\*\* \(no change\)\n\nFalse positive/);
});

test("dry run 只列出计划，不建分支也不起 agent", async () => {
  const github = fakeGithub([alert(1), alert(2)]);
  const cursor = fakeCursor({});
  const { items } = await runCodeqlAutofix({ repo: REPO, baseRef: "main", github, cursor, model: MODEL, dryRun: true, log: quiet, sleep: noSleep });
  assert.deepEqual(items.map((item) => item.outcome), ["would launch", "would launch"]);
  assert.equal(github.calls.created.length, 0);
  assert.equal(cursor.calls.create.length, 0);
  assert.match(renderSummary({ items, dryRun: true }), /dry run/);
});

test("agent 起不来就删掉标记分支并以失败退出", async () => {
  const github = fakeGithub([alert(1)]);
  const cursor = fakeCursor({}, { failCreate: () => true });
  const { items, code } = await runCodeqlAutofix({ repo: REPO, baseRef: "main", github, cursor, model: MODEL, log: quiet, sleep: noSleep });
  assert.equal(code, 1);
  assert.equal(items[0].outcome, "launch failed");
  assert.deepEqual(github.calls.deleted, ["codeql-fix/alert-1"]);
});

test("分支已被并发创建时按已派过处理", async () => {
  const github = fakeGithub([alert(1)], { createError: new HttpError("GitHub", "POST", "/git/refs", 422, "Reference already exists") });
  const cursor = fakeCursor({});
  const { items, code } = await runCodeqlAutofix({ repo: REPO, baseRef: "main", github, cursor, model: MODEL, log: quiet, sleep: noSleep });
  assert.equal(code, 0);
  assert.equal(items[0].outcome, "already attempted");
  assert.equal(cursor.calls.create.length, 0);
});

test("等到期限仍在跑的标为 still running；取消时一并取消 Cursor 运行", async () => {
  let t = 0;
  const github = fakeGithub([alert(1)]);
  const cursor = fakeCursor({});
  const { items } = await runCodeqlAutofix({ repo: REPO, baseRef: "main", github, cursor, model: MODEL, waitMs: 60_000, now: () => t, sleep: async (ms) => { t += ms; }, log: quiet });
  assert.equal(items[0].outcome, "still running");

  const abort = new AbortController();
  const cancelling = fakeCursor({});
  const run = runCodeqlAutofix({ repo: REPO, baseRef: "main", github: fakeGithub([alert(1)]), cursor: cancelling, model: MODEL, signal: abort.signal, log: quiet, sleep: async () => abort.abort() });
  const { items: cancelled } = await run;
  assert.deepEqual(cancelling.calls.cancel, ["bc-1"]);
  assert.equal(cancelled[0].outcome, "cancelled");
});

test("没有告警时摘要直说", () => {
  assert.match(renderSummary({ items: [] }), /No open CodeQL alerts/);
});

test("模型配置拆成 id 与参数", () => {
  assert.deepEqual(parseModel(MODEL), { id: "grok-4.7", params: [{ id: "reasoning_effort", value: "xhigh" }, { id: "fast", value: "true" }] });
  assert.deepEqual(parseModel("composer-2.5"), { id: "composer-2.5" });
  assert.throws(() => parseModel("grok-4.7 fast"), /key=value/);
});
