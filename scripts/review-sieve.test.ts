import assert from "node:assert/strict";
import { test } from "node:test";
import { classify, plain, severity, sieve, sievePr, type PrCommit, type PrData } from "./review-sieve.ts";

const FIX = "e2495e54b6a1c0ffee0000000000000000000001";
const NEXT = "780d6320e8a1c0ffee0000000000000000000002";
const MAIN_ONLY = "c08625bd00a1c0ffee0000000000000000000003";
const commits: PrCommit[] = [
  { sha: "6de370465da1c0ffee0000000000000000000000", at: "2026-10-17T08:17:10Z", subject: "feat(ai): 首页对话记录存进 ChatLog", merge: false },
  { sha: FIX, at: "2026-10-17T08:19:00Z", subject: "fix(ai): 拒答记为 refused", merge: false },
  { sha: NEXT, at: "2026-10-17T08:20:39Z", subject: "fix(ai): 对话记录按实际作答档位记", merge: false },
];
const at = "2026-10-17T08:18:00Z";
const reply = (body: string, when = "2026-10-17T08:20:33Z") => ({ body, at: when, url: "https://example.test/r" });

test("回复里的 SHA 是本 PR 的提交就算已采纳，短 SHA 按前缀认", () => {
  const result = classify(at, [reply("已修（e2495e5）：最近 14 天改按 todayAtSource 截止。")], [], commits);
  assert.equal(result.verdict, "adopted");
  assert.equal(result.evidence, "e2495e5");
  assert.equal(classify(at, [reply(`Fixed in ${FIX}.`)], [], commits).verdict, "adopted");
});

test("回复只引用早于建议的提交时是可能采纳，不算已采纳", () => {
  const result = classify(at, [reply("原实现见 6de3704，按设计如此。")], [], commits);
  assert.equal(result.verdict, "uncertain");
  assert.match(result.evidence, /6de3704 在本 PR 提交里，但都早于这条建议/);
  assert.equal(classify(at, [reply("6de3704 引入，e2495e5 修了。")], [], commits).evidence, "e2495e5");
});

test("SHA 不在本 PR 的提交里不算采纳，粘在别的字母数字里的串不当 SHA", () => {
  const notInPr = classify(at, [reply(`已修（${MAIN_ONLY.slice(0, 8)}）。`)], [], commits);
  assert.equal(notInPr.verdict, "uncertain");
  assert.match(notInPr.evidence, /c08625bd 不在本 PR 提交里/);
  assert.equal(classify(at, [reply("见 xe2495e5 与 e2495e5z")], [], commits).verdict, "uncertain");
});

test("说成立但没写 SHA 的是可能采纳：下一个提交修取回复之后那个，已修取回复之前那个", () => {
  const future = classify(at, [reply("成立，下一个提交（尚未推送）修：拒答时带 refused。")], [], commits);
  assert.equal(future.verdict, "uncertain");
  assert.match(future.evidence, /「成立」/);
  assert.equal(future.candidate, "780d632 fix(ai): 对话记录按实际作答档位记");
  const done = classify(at, [reply("已改：只对 data URI 用 sync。")], [], commits);
  assert.equal(done.verdict, "uncertain");
  assert.equal(done.candidate, "e2495e5 fix(ai): 拒答记为 refused");
});

test("说不改、复现不出、保持现状，或者根本没回复，都是未采纳", () => {
  for (const body of ["这条不改。", "实测复现不出来，先放着。", "保持现状：与旧行为一致。", "这条不在本 PR 修。", "有意如此：只播一次。"]) {
    assert.equal(classify(at, [reply(body)], [], commits).verdict, "notAdopted", body);
  }
  const silent = classify(at, [], [], commits);
  assert.deepEqual([silent.verdict, silent.evidence, silent.reply], ["notAdopted", "没有回复", null]);
  assert.equal(classify(at, [reply("已修：行为不改变，只补了测试。")], [], commits).verdict, "uncertain");
});

test("同一线程里最后表态的回复说了算；有 SHA 又说不改的交给模型读原文", () => {
  const replies = [reply("属实：这个取舍交给 lyjw 定。", "2026-10-17T08:19:00Z"), reply("lyjw 定了保持现状。", "2026-10-17T09:00:00Z")];
  assert.equal(classify(at, replies, [], commits).verdict, "notAdopted");
  const mixed = classify(at, [reply("保持现状。`e2495e5` 在注释里写明了这个取舍。")], [], commits);
  assert.equal(mixed.verdict, "uncertain");
  assert.match(mixed.evidence, /e2495e5 在本 PR 提交里，但回复也说「保持现状」/);
});

test("没有行内回复、之后有普通评论的标可能采纳，指向那条评论", () => {
  const general = [reply("反馈已按 commit e2495e5 修复，三条都处理了。", "2026-10-17T09:00:00Z"), reply("早于建议", "2026-10-17T08:00:00Z")];
  const result = classify(at, [], general, commits);
  assert.equal(result.verdict, "uncertain");
  assert.match(result.evidence, /没有行内回复，之后有普通评论 https:\/\/example\.test\/r（含 e2495e5）/);
});

const codexBody = "**<sub><sub>![P1 Badge](https://img.shields.io/badge/P1-orange?style=flat)</sub></sub>  Preserve saved conversations across the tier rename**\n\nAny browser with existing chat history…";
const devinBody =
  '<!-- devin-review-comment {"id": "BUG_x_0001", "kind": "bug"} -->\n\n🔴 **近七天编码用量漏算实际日期**\n\n`codingYear` 的 `daysSums` 从数组尾部累计。\n\n<details>\n<summary>Learn more</summary>\n\n细节\n</details>';
const owner = { login: "LYJW131", id: 153256373 };
const cloud = { login: "An0nCh1hayaa", id: 300701323 };
const codex = { login: "chatgpt-codex-connector[bot]", id: 199175422 };
const devin = { login: "devin-ai-integration", id: 158243242 };
const rawCommits = (list: PrCommit[]) => list.map((c) => ({ sha: c.sha, parents: [{}], commit: { message: `${c.subject}\n\n正文`, committer: { date: c.at } } }));
const comment = (id: number, user: { login: string; id: number }, body: string, extra: Record<string, unknown> = {}) => ({
  id,
  user,
  body,
  path: "shared/god-chat.ts",
  line: 206,
  created_at: "2026-10-17T08:18:00Z",
  html_url: `https://github.com/LYJW131/lyjwpage/pull/387#discussion_r${id}`,
  ...extra,
});

function prData(): PrData {
  return {
    comments: [
      comment(1, codex, codexBody),
      comment(2, devin, devinBody, { line: null, original_line: 187 }),
      comment(3, { login: "claude[bot]", id: 209825114 }, "**Claude 自己的评审**"),
      comment(4, owner, "已修（e2495e5）：会话整段保留。", { in_reply_to_id: 1, created_at: "2026-10-17T08:20:00Z" }),
      comment(5, { login: "someone", id: 1 }, "已修（e2495e5）。", { in_reply_to_id: 2 }),
      comment(6, codex, "**补一句**", { in_reply_to_id: 1 }),
      comment(7, cloud, "成立，下一个提交修。", { in_reply_to_id: 3 }),
    ],
    issueComments: [
      { id: 10, user: codex, body: "<!-- codex-pull-request-review-summary -->\n## Codex Review Summary\n\n…", created_at: at, html_url: "https://x.test/10" },
      { id: 11, user: owner, body: `验证回执 ${"a".repeat(40)}：unit-test-verified`, created_at: "2026-10-17T09:00:00Z", html_url: "https://x.test/11" },
    ],
    reviews: [
      { id: 20, user: devin, body: "**Devin Review** found 2 potential issues.\n\n<!-- devin-review-badge-begin -->", submitted_at: at, html_url: "https://x.test/20" },
      { id: 21, user: codex, body: "### 💡 Codex Review\n\nHere are some automated review suggestions for this pull request.", submitted_at: at, html_url: "https://x.test/21" },
      { id: 22, user: owner, body: "", submitted_at: "2026-10-17T08:20:00Z", html_url: "https://x.test/22" },
      { id: 23, user: codex, body: "**<sub><sub>![P2 Badge](x)</sub></sub>  Guard the fallback path**\n\n没挂到行上的建议", submitted_at: at, html_url: "https://x.test/23" },
    ],
    commits: rawCommits(commits),
  };
}

test("sievePr 只收 Codex、Devin 的根评论，只认 lyjw 两个账号的回复，带上严重度与标题", () => {
  const items = sievePr(387, prData());
  assert.deepEqual(
    items.map((i) => [i.bot, i.severity, i.suggestion, i.line, i.verdict, i.evidence]),
    [
      ["codex", "P1", "Preserve saved conversations across the tier rename", 206, "adopted", "e2495e5"],
      ["devin", "🔴 bug", "近七天编码用量漏算实际日期", 187, "notAdopted", "没有回复"],
      ["codex", "P2", "Guard the fallback path", null, "uncertain", "非行内建议，脚本不判"],
    ],
  );
  assert.equal(items[0].reply, "已修（e2495e5）：会话整段保留。");
  assert.equal(severity(devinBody), "🔴 bug");
});

type Route = Record<string, unknown>;
function fakeFetch(routes: Route, calls: string[] = []) {
  return async (url: string) => {
    const { pathname, searchParams } = new URL(url);
    const path = pathname.replace("/repos/LYJW131/lyjwpage/", "");
    calls.push(`${path}?page=${searchParams.get("page")}`);
    const key = searchParams.get("page") === "1" ? path : `${path}#${searchParams.get("page")}`;
    if (!(key in routes)) return { ok: true, json: async () => [] };
    const value = routes[key];
    if (value instanceof Error) return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, json: async () => value };
  };
}
const pull = (number: number, merged_at: string | null, updated_at = merged_at ?? "2026-10-19T00:00:00Z") => ({ number, merged_at, updated_at, title: `PR ${number}` });
const emptyPr = (n: number): Route => ({ [`pulls/${n}/comments`]: [], [`issues/${n}/comments`]: [], [`pulls/${n}/reviews`]: [], [`pulls/${n}/commits`]: [] });

test("sieve 按 (合并时间, PR 号) 越过书签、排好序，超出上限的记 backlog", async () => {
  const routes: Route = {
    pulls: [
      pull(406, "2026-10-19T02:00:00Z"),
      pull(404, "2026-10-19T01:00:00Z"),
      pull(399, null, "2026-10-19T01:30:00Z"),
      pull(405, "2026-10-18T21:13:04Z"),
      pull(402, "2026-10-18T21:13:04Z"),
      pull(380, "2026-10-17T00:00:00Z"),
    ],
    ...emptyPr(404),
    ...emptyPr(405),
    ...emptyPr(406),
  };
  const result = await sieve({ bookmark: { lastMergedAt: "2026-10-18T21:13:04Z", lastNumber: 403 }, limit: 2 }, { fetch: fakeFetch(routes) });
  assert.deepEqual(result.read, [405, 404]);
  assert.equal(result.backlog, 1);
  assert.deepEqual(result.bookmark, { lastMergedAt: "2026-10-19T01:00:00Z", lastNumber: 404 });
  assert.deepEqual(result.failed, []);
});

test("中途有 PR 读失败：书签停在它之前，后面读到的照常输出", async () => {
  const routes: Route = {
    pulls: [pull(410, "2026-10-19T03:00:00Z"), pull(409, "2026-10-19T02:00:00Z"), pull(408, "2026-10-19T01:00:00Z")],
    ...emptyPr(408),
    ...emptyPr(409),
    ...emptyPr(410),
    "pulls/409/reviews": new Error("boom"),
    "pulls/410/comments": [comment(1, codex, codexBody)],
  };
  const result = await sieve({ bookmark: { lastMergedAt: "2026-10-18T21:13:04Z", lastNumber: 403 }, limit: 70 }, { fetch: fakeFetch(routes) });
  assert.deepEqual(result.read, [408, 410]);
  assert.deepEqual(result.failed, [{ pr: 409, error: "pulls/409/reviews HTTP 500" }]);
  assert.deepEqual(result.bookmark, { lastMergedAt: "2026-10-19T01:00:00Z", lastNumber: 408 });
  assert.deepEqual(result.counts, { adopted: 0, uncertain: 0, notAdopted: 1 });
  assert.equal(result.notAdopted[0].pr, 410);
});

test("第一个 PR 就读失败或列不出 PR 时书签不动；评论超过一页会翻页", async () => {
  const bookmark = { lastMergedAt: "2026-10-18T21:13:04Z", lastNumber: 403 };
  const firstFails = await sieve({ bookmark, limit: 70 }, { fetch: fakeFetch({ pulls: [pull(404, "2026-10-19T01:00:00Z")], "pulls/404/commits": new Error("x") }) });
  assert.deepEqual(firstFails.bookmark, bookmark);
  const listFails = await sieve({ bookmark, limit: 70 }, { fetch: fakeFetch({ pulls: new Error("x") }) });
  assert.deepEqual([listFails.bookmark, listFails.failed[0].pr], [bookmark, null]);

  const calls: string[] = [];
  const page = Array.from({ length: 100 }, (_, i) => comment(1000 + i, devin, "**旧建议**"));
  await sieve({ bookmark, limit: 70 }, { fetch: fakeFetch({ pulls: [pull(404, "2026-10-19T01:00:00Z")], "pulls/404/comments": page }, calls) });
  assert.ok(calls.includes("pulls/404/comments?page=2"));
});


test("plain 删到切口拼不回注释和标签，没闭合的注释只删起手，空尖括号留着", () => {
  assert.equal(plain("<!<!--x-->-->正文"), "正文");
  assert.equal(plain("<scrip<script>t>正文</script>"), "正文");
  assert.equal(plain("已修 `<!--`（e2495e5）"), "已修 ``（e2495e5）");
  assert.equal(plain("Map<> 留着"), "Map<> 留着");
});
