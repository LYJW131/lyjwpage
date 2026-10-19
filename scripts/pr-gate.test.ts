import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  buildCoverage,
  buildThreads,
  CODEX_MAX_ROUNDS,
  gate,
  REQUIRED_CHECKS,
  reviewerSummary,
  severityOf,
  tierOf,
  type CheckRun,
} from "./pr-gate.ts";

const HEAD = "a".repeat(40);
const OLD = "b".repeat(40);
const OLDER = "c".repeat(40);
const lyjw = { login: "LYJW131", id: 153256373 };
const codex = { login: "chatgpt-codex-connector[bot]", id: 199175422 };
const devin = { login: "devin-ai-integration[bot]", id: 158243242 };
const claude = { login: "claude[bot]", id: 209825114 };

const codexBody = (p: string) => `**<sub><sub>![${p} Badge](https://img.shields.io/badge/${p}-orange?style=flat)</sub></sub>  Preserve legacy traces**\n\n正文`;
const devinBody = (kind: string, mark: string) =>
  `<!-- devin-review-comment {"id": "X", "file_path": "a.ts", "kind": "${kind}"} -->\n\n${mark} **标题**\n\n正文`;
const build = (worker: string, conclusion: string | null, extra: Partial<CheckRun> = {}): CheckRun => ({
  name: `Workers Builds: ${worker}`,
  status: conclusion === null ? "in_progress" : "completed",
  conclusion,
  ...extra,
});

test("分档：只改 md 与 .claude 是 docs，界面与逻辑按路径分，默认的回执等级与判定跟着档走", () => {
  const docs = tierOf(["README.md", "docs/workers-builds.md", "docs/architecture.json", ".claude/skills/x/feature-map.json", "DESIGN.md"]);
  assert.deepEqual([docs.name, docs.need, docs.judge], ["docs", null, false]);
  const ui = tierOf(["src/components/card.tsx", "src/app/site.css", "public/sw.js", "docs/explainer/v2/index.html", "docs/a.md"]);
  assert.deepEqual([ui.name, ui.need, ui.judge, ui.logic], ["ui", "live-ui-verified", false, []]);
  const logic = tierOf(["src/lib/x.ts", "src/app/api/version/route.ts", "workers/core/src/a.ts", "scripts/pr-gate.ts"]);
  assert.deepEqual([logic.name, logic.need, logic.judge, logic.ui], ["logic", "unit-test-verified", true, []]);
  const skillScripts = tierOf([".claude/skills/x/check.py", ".claude/skills/x/errors-query.js", ".claude/skills/x/SKILL.md"]);
  assert.deepEqual(skillScripts.logic, [".claude/skills/x/check.py", ".claude/skills/x/errors-query.js"]);
  const both = tierOf(["src/components/card.tsx", "shared/json.ts"]);
  assert.deepEqual([both.name, both.need, both.judge], ["ui+logic", "live-ui-verified", true]);
  assert.match(both.hint, /lyjw 看图点头/);
});

test("严重度：Codex 徽章、Claude 圆圈、Devin 种类与圆圈、其他机器人的文字标签", () => {
  assert.deepEqual(severityOf(codexBody("P0"), "codex"), { mark: "P0", level: "blocking" });
  assert.deepEqual(severityOf(codexBody("P1"), "codex"), { mark: "P1", level: "blocking" });
  assert.deepEqual(severityOf(codexBody("P2"), "codex"), { mark: "P2", level: "normal" });
  assert.deepEqual(severityOf(codexBody("P3"), "codex"), { mark: "P3", level: "optional" });
  assert.deepEqual(severityOf("🔴 **Important** (optional) 缓存失效", "claude"), { mark: "🔴", level: "blocking" });
  assert.deepEqual(severityOf("🟡 **Nit** (optional) 命名", "claude"), { mark: "🟡", level: "optional" });
  assert.deepEqual(severityOf("🟣 **Pre-existing** 旧问题", "claude"), { mark: "🟣", level: "pre-existing" });
  assert.deepEqual(severityOf(devinBody("bug", "🔴"), "devin"), { mark: "🔴", level: "blocking" });
  assert.deepEqual(severityOf(devinBody("bug", "🟡"), "devin"), { mark: "🟡", level: "normal" });
  assert.deepEqual(severityOf(devinBody("security", "🟨"), "devin"), { mark: "🟨", level: "security" });
  assert.deepEqual(severityOf(devinBody("analysis", "🔍"), "devin"), { mark: "🔍", level: "info" });
  assert.deepEqual(severityOf("**Blocker**: 会丢数据", "cursor"), { mark: "blocker", level: "blocking" });
  assert.deepEqual(severityOf("nit: 多了个空格", null), { mark: "nit", level: "optional" });
  assert.deepEqual(severityOf("Security: token 进了日志", null), { mark: "security", level: "security" });
  assert.deepEqual(severityOf("这里少了一个分支", null), { mark: null, level: "unmarked" });
});

test("评审线程按根评论归并：发起人、标记、最后一条是不是 lyjw 的账号回的，只列没解决的", () => {
  const comments = [
    { id: 1, user: codex, body: codexBody("P1"), html_url: "u1", path: "a.ts", line: 3, created_at: "2026-10-19T01:00:00Z" },
    { id: 2, in_reply_to_id: 1, user: lyjw, body: "已修（abc1234）", created_at: "2026-10-19T01:05:00Z" },
    { id: 3, user: devin, body: devinBody("bug", "🟡"), html_url: "u3", path: "b.ts", line: null, original_line: 9, created_at: "2026-10-19T01:01:00Z" },
    { id: 4, user: claude, body: "🔴 缓存失效", html_url: "u4", path: "c.ts", line: 1, created_at: "2026-10-19T01:02:00Z" },
  ];
  const resolved = new Map([
    [1, { resolved: false, outdated: false }],
    [3, { resolved: false, outdated: true }],
    [4, { resolved: true, outdated: false }],
  ]);
  const threads = buildThreads(comments, { source: "ccr", byRoot: resolved });
  assert.equal(threads.total, 3);
  assert.deepEqual(
    threads.unresolved.map((t) => [t.by, t.mark, t.level, t.lastByLyjw, t.line, t.url]),
    [
      [codex.login, "P1", "blocking", true, 3, "u1"],
      [devin.login, "🟡", "normal", false, 9, "u3"],
    ],
  );
  assert.equal(threads.unresolved[0].title, "Preserve legacy traces");

  const unknown = buildThreads(comments, { source: "rest", byRoot: null });
  assert.equal(unknown.resolvedKnown, false);
  assert.equal(unknown.unresolved.length, 3);
});

test("线程标题反复去掉标签，嵌套拼回的 script 不留在标题里", () => {
  const titleOf = (body: string) =>
    buildThreads([{ id: 9, user: claude, body, html_url: "u", path: "a.ts", line: 1, created_at: "2026-10-19T01:03:00Z" }], {
      source: "ccr",
      byRoot: new Map([[9, { resolved: false, outdated: false }]]),
    }).unresolved[0].title;
  assert.equal(titleOf("<b>Visible</b> heading"), "Visible heading");
  assert.equal(titleOf("<scrip<script>is removed</script>t>alert(123)</script>"), "alert(123)");
});

test("Codex 轮数：有意见的评审各算一轮，没意见那轮从汇总评论的状态里补，额度用完的不算", () => {
  const state = (sha: string, status: string) => ({
    user: codex,
    body: `<!-- codex-pull-request-review-summary -->\n<!-- codex-review-state:v1 {"code_review":{"commit_sha":"${sha}","status":"${status}"}} -->\n\n## Codex Review Summary`,
  });
  const reviews = [
    { user: codex, commit_id: OLDER },
    { user: lyjw, commit_id: OLDER },
    { user: codex, commit_id: OLD },
    { user: devin, commit_id: OLDER },
  ];
  const done = reviewerSummary(reviews, [state(HEAD, "completed"), { user: claude, body: "## Code review\n\nNo issues found." }], HEAD);
  assert.deepEqual(done.find((r) => r.bot === "codex"), {
    bot: "codex",
    reviews: 2,
    rounds: 3,
    maxRounds: CODEX_MAX_ROUNDS,
    status: "completed",
    statusCommit: HEAD,
    lastReviewed: HEAD,
    coversHead: true,
  });
  assert.deepEqual(done.find((r) => r.bot === "devin"), { bot: "devin", reviews: 1, lastReviewed: OLDER, coversHead: false });
  assert.deepEqual(done.find((r) => r.bot === "claude"), { bot: "claude", reviews: 0, lastReviewed: null, coversHead: false });

  const failed = reviewerSummary(reviews, [state(HEAD, "failed")], HEAD).find((r) => r.bot === "codex");
  assert.deepEqual([failed?.rounds, failed?.status, failed?.lastReviewed], [2, "failed", OLD]);
});

test("Codex 轮数上限与 HUMAN.md「5. PR 与合并」写的一致", () => {
  const human = readFileSync(new URL("../HUMAN.md", import.meta.url), "utf8");
  const match = /Codex 每个 PR 最多([一二三四五六七八九十\d]+)轮/.exec(human);
  assert.ok(match, "HUMAN.md 里找不到「Codex 每个 PR 最多 N 轮」");
  const numerals = "零一二三四五六七八九十";
  const limit = /^\d+$/.test(match[1]) ? Number(match[1]) : numerals.indexOf(match[1]);
  assert.equal(CODEX_MAX_ROUNDS, limit);
});


function fakeGh(routes: Record<string, unknown>) {
  return {
    get: async <T>(path: string): Promise<T> => {
      const key = path.split("?")[0];
      if (!(key in routes)) throw new Error(`${key} HTTP 404`);
      return routes[key] as T;
    },
  };
}

test("构建覆盖：head 上有就看结论；head 上没有时往前找，之后没碰到路径算沿用，碰到了算缺", async () => {
  const files = ["src/components/card.tsx", "workers/core/src/a.ts"];
  const headRuns = [build("site", "success")];
  const routes = {
    [`commits/${OLD}/check-runs`]: { check_runs: [] },
    [`commits/${OLDER}/check-runs`]: { check_runs: [build("core", "success"), build("site", "success")] },
    [`compare/${OLDER}...${HEAD}`]: { files: [{ filename: "docs/a.md" }] },
  };
  const carried = await buildCoverage({ gh: fakeGh(routes), files, head: HEAD, headRuns, commits: [OLDER, OLD, HEAD] });
  assert.deepEqual(carried, { expected: ["core", "site"], missing: [], carried: [{ worker: "core", from: OLDER }] });

  const touched = await buildCoverage({
    gh: fakeGh({ ...routes, [`compare/${OLDER}...${HEAD}`]: { files: [{ filename: "workers/ai/src/x.ts" }] } }),
    files,
    head: HEAD,
    headRuns,
    commits: [OLDER, OLD, HEAD],
  });
  assert.deepEqual(touched.missing.map((m) => m.worker), ["core"]);
  assert.match(touched.missing[0].reason, /碰到了它的监视路径/);

  const never = await buildCoverage({ gh: fakeGh(routes), files, head: HEAD, headRuns: [build("site", "failure")], commits: [OLD, HEAD] });
  assert.deepEqual(
    never.missing.map((m) => [m.worker, m.reason]),
    [
      ["site", "head 上的构建结论是 failure"],
      ["core", "PR 的提交上都没有它的构建检查"],
    ],
  );

  const skipped = await buildCoverage({ gh: fakeGh(routes), files, head: HEAD, headRuns: [build("site", "skipped"), build("core", "neutral")], commits: [HEAD] });
  assert.deepEqual(skipped.missing.map((m) => m.reason), ["head 上的构建结论是 neutral", "head 上的构建结论是 skipped"]);
});

const FILES = (names: string[]) => names.map((filename) => ({ filename }));

function fakeFetch(routes: Record<string, unknown>) {
  return async (url: string) => {
    const path = url.replace("https://api.github.com/repos/LYJW131/lyjwpage/", "");
    const [key, query = ""] = path.split("?");
    const page = Number(/(?:^|&)page=(\d+)/.exec(query)?.[1] ?? 1);
    if (!(key in routes)) return { ok: false, status: url.endsWith("/graphql") ? 403 : 404, json: async () => ({}) };
    const body = routes[key];
    return { ok: true, json: async () => (Array.isArray(body) && page > 1 ? [] : body) };
  };
}

function pullRoutes(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    "pulls/7": { number: 7, title: "t", state: "open", draft: false, mergeable: true, mergeable_state: "clean", head: { sha: HEAD }, labels: [] },
    "pulls/7/files": FILES(["docs/a.md"]),
    "pulls/7/commits": [{ sha: HEAD }],
    "pulls/7/reviews": [],
    "pulls/7/comments": [],
    "issues/7/comments": [],
    [`commits/${HEAD}/check-runs`]: { check_runs: [{ name: "check", status: "completed", conclusion: "success" }] },
    [`commits/${HEAD}/status`]: { statuses: [] },
    "pulls/7/ccr/review_threads": [],
    ...overrides,
  };
}

test("只改文档、CI 绿、线程都解决时 ready，不要回执", async () => {
  const result = await gate({ pr: 7 }, { fetch: fakeFetch(pullRoutes()), patchId: () => null });
  assert.equal(result.tier.name, "docs");
  assert.equal(result.receipt, null);
  assert.deepEqual(result.todo, []);
  assert.equal(result.ready, true);
});

test("逻辑档：检查在跑、线程没解决、Codex 没审到 head、没回执与判定，逐条进 todo", async () => {
  const routes = pullRoutes({
    "pulls/7": { number: 7, title: "t", state: "open", draft: true, mergeable: false, mergeable_state: "dirty", head: { sha: HEAD }, labels: [{ name: "baseline-exception" }] },
    "pulls/7/files": FILES(["workers/collector/src/a.ts"]),
    "pulls/7/reviews": [{ user: codex, commit_id: OLD }],
    "pulls/7/comments": [{ id: 11, user: codex, body: codexBody("P1"), html_url: "u", path: "a.ts", line: 1, created_at: "2026-10-19T00:00:00Z" }],
    [`commits/${HEAD}/check-runs`]: {
      check_runs: [
        { id: 1, name: "check", status: "completed", conclusion: "failure", started_at: "2026-10-19T00:00:00Z" },
        { id: 2, name: "check", status: "in_progress", conclusion: null, started_at: "2026-10-19T00:05:00Z" },
      ],
    },
    [`commits/${HEAD}/status`]: { statuses: [{ context: "Devin Review", state: "failure", target_url: "d" }] },
    "pulls/7/ccr/review_threads": [{ resolved: false, outdated: false, comment_ids: [11] }],
  });
  const result = await gate({ pr: 7 }, { fetch: fakeFetch(routes), patchId: () => null });
  assert.equal(result.tier.name, "logic");
  assert.equal(result.baselineException, true);
  assert.deepEqual(result.checks.pending, ["check"]);
  assert.deepEqual(result.workersBuilds.expected, []);
  assert.deepEqual(result.workersBuilds.afterMerge, ["collector"]);
  assert.equal(result.threads.unresolved[0].level, "blocking");
  assert.equal(result.ready, false);
  const todo = result.todo.join("\n");
  for (const want of [/草稿/, /冲突/, /还有检查在跑：check/, /Devin Review」结论是 failure/, /1 条评审线程没解决（1 条红圈/, /Codex 还没审到 head（已用 1\/3 轮/, /没有验证回执/, /没有判定/]) {
    assert.match(todo, want);
  }
});

test("head 上还没有 CI 的 check 时不 ready", async () => {
  const result = await gate({ pr: 7 }, { fetch: fakeFetch(pullRoutes({ [`commits/${HEAD}/check-runs`]: { check_runs: [] } })), patchId: () => null });
  assert.equal(result.ready, false);
  assert.match(result.todo.join("\n"), /还没有「check」检查/);
});

test("REQUIRED_CHECKS 都是 CI 工作流里的 job", () => {
  const workflow = readFileSync(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");
  for (const name of REQUIRED_CHECKS) assert.match(workflow, new RegExp(`^  ${name}:$`, "m"));
});

test("要判定时 Claude review 与 Devin 都得审过一次，盖没盖住 head 不管", async () => {
  const routes = pullRoutes({
    "pulls/7/files": FILES(["workers/collector/src/a.ts"]),
    "pulls/7/reviews": [{ user: devin, commit_id: OLD }],
  });
  const missing = (await gate({ pr: 7, need: null }, { fetch: fakeFetch(routes), patchId: () => null })).todo.join("\n");
  assert.match(missing, /claude 还没评审这个 PR/);
  assert.doesNotMatch(missing, /devin 还没评审/);
  const both = pullRoutes({ ...routes, "issues/7/comments": [{ user: claude, body: "## Code review\n\nNo issues found." }] });
  const todo = (await gate({ pr: 7, need: null }, { fetch: fakeFetch(both), patchId: () => null })).todo.join("\n");
  assert.doesNotMatch(todo, /还没评审这个 PR/);
});

test("--no-judge 与 --need 覆盖分档；线程解决状态读不到时进 todo", async () => {
  const routes = pullRoutes({ "pulls/7/files": FILES(["reporters/server-reporter/src/a.ts"]) });
  delete routes["pulls/7/ccr/review_threads"];
  const result = await gate({ pr: 7, need: null, judge: false }, { fetch: fakeFetch(routes), patchId: () => null });
  assert.deepEqual([result.tier.need, result.tier.judge, result.receipt], [null, false, null]);
  assert.equal(result.threads.source, "rest");
  assert.equal(result.tier.name, "logic");
  assert.equal(result.todo.length, 1);
  assert.match(result.todo[0], /拿不到评审线程的解决状态/);
});

test("命令行：缺 --pr、等级写错、未知选项都按用法错误退出 2", () => {
  const script = new URL("./pr-gate.ts", import.meta.url).pathname;
  for (const args of [[], ["--pr"], ["--pr", "7", "--need", "live"], ["--pr", "7", "--level", "live-ui-verified"]]) {
    const run = spawnSync(process.execPath, ["--experimental-strip-types", script, ...args], { encoding: "utf8" });
    assert.equal(run.status, 2, `${args.join(" ")}: ${run.stdout}${run.stderr}`);
  }
});
