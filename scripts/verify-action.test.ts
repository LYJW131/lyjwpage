import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { tierOf } from "./pr-gate/tier.ts";
import { bodyDigest } from "./verify-action/body.ts";
import { judgeComment, judgeVerdict, main, parseBody, planOf, receiptComment, reconcile, shotLinks, staleRead } from "./verify-action.ts";
import { parseComments, stampLine } from "./verify-receipt.ts";

const HEAD = "a".repeat(40);

test("parseBody 取验证清单的 V 条目与 lyjw 原话，别的节和注释不算", () => {
  const body = [
    "<!-- claude-projects-attribution -->",
    "说明",
    "## 验证清单",
    "- V1：首页 375px 上 Pulse 卡在 Vibe Coding 卡上方",
    "- V2: `pnpm test` 绿",
    "- 没编号的不算",
    "- V1：重复的编号只认第一条",
    "## lyjw 原话",
    "> 把卡片换个位置",
    "",
    "## 其他",
    "- V3：别的节里的不算",
  ].join("\n");
  const { checklist, words } = parseBody(body);
  assert.deepEqual(checklist, [
    { id: "V1", text: "首页 375px 上 Pulse 卡在 Vibe Coding 卡上方" },
    { id: "V2", text: "`pnpm test` 绿" },
  ]);
  assert.equal(words, "> 把卡片换个位置");
  assert.deepEqual(parseBody(null), { checklist: [], words: null });
});

const row = (id: string, result: string) => ({ id, check: id, result, evidence: "e" });

test("reconcile：清单每项都要有 PASS 行，FAIL 记 verifier-failed，漏项或 SKIPPED 记 verifier-blocked", () => {
  const checklist = [{ id: "V1", text: "" }, { id: "V2", text: "" }];
  const report = (rows: ReturnType<typeof row>[], level = "live-ui-verified") => ({ model: "m", level, rows, notVerified: [] });
  assert.equal(reconcile(checklist, report([row("V1", "PASS"), row("V2", "PASS"), row("X1", "PASS")])).level, "live-ui-verified");
  assert.equal(reconcile(checklist, report([row("V1", "PASS"), row("V2", "FAIL")])).level, "verifier-failed");
  assert.equal(reconcile(checklist, report([row("V1", "PASS"), row("X1", "FAIL")])).level, "verifier-failed");
  const missing = reconcile(checklist, report([row("V1", "PASS")]));
  assert.deepEqual([missing.level, missing.problems], ["verifier-blocked", ["V2 没有对应的检查行"]]);
  assert.equal(reconcile(checklist, report([row("V1", "PASS"), row("V2", "SKIPPED")])).level, "verifier-blocked");
  assert.equal(reconcile([], report([], "made-up-level")).level, "verifier-blocked");
  const empty = reconcile([], report([]));
  assert.deepEqual([empty.level, empty.problems], ["verifier-blocked", ["没有任何检查行"]]);
  const bare = reconcile(checklist, report([row("V1", "PASS"), { ...row("V2", "PASS"), evidence: " " }]));
  assert.deepEqual([bare.level, bare.problems], ["verifier-blocked", ["V2 是 PASS 但没写证据"]]);
  assert.equal(reconcile([], report([], "verifier-failed")).level, "verifier-failed");
  const noShots = reconcile(checklist, report([row("V1", "PASS"), row("V2", "PASS")]), { shots: 0 });
  assert.deepEqual([noShots.level, noShots.problems], ["verifier-blocked", ["live-ui-verified 没有截图上传成功"]]);
  assert.equal(reconcile(checklist, report([row("V1", "PASS"), row("V2", "PASS")], "unit-test-verified"), { shots: 0 }).level, "unit-test-verified");
});

test("planOf：草稿、已关闭与只改文档的不验，界面档等预览，PR 要了才判定", () => {
  const trusted = { trustedAuthor: true };
  const pull = (extra: object = {}) => ({ number: 7, title: "t", state: "open", mergeable: true, head: { sha: HEAD, ref: "claude/x" }, ...extra });
  assert.deepEqual(planOf(pull(), tierOf(["src/components/a.tsx"], trusted)), {
    need: "live-ui-verified",
    judge: false,
    ui: true,
    tier: "ui",
    head: HEAD,
    branch: "claude/x",
  });
  assert.deepEqual([planOf(pull(), tierOf(["workers/core/src/a.ts"], trusted))].map((p) => [p.need, p.judge, p.ui]), [["unit-test-verified", false, false]]);
  assert.equal(planOf(pull(), tierOf(["workers/core/src/a.ts"], { ...trusted, judgeAsked: true })).judge, true);
  assert.equal(planOf(pull(), tierOf(["docs/a.md"], trusted)).need, "");
  assert.equal(planOf(pull({ draft: true }), tierOf(["src/components/a.tsx"], trusted)).need, "");
  assert.equal(planOf(pull({ state: "closed" }), tierOf(["src/components/a.tsx"], trusted)).judge, false);
});

test("评论第一行给人看、第二行是机器读的 JSON，parseComments 认得出来；表格里的竖线与换行被转义", () => {
  const digest = "b".repeat(64);
  const stamp = { sha: HEAD, level: "verifier-blocked", body: digest };
  const receipt = receiptComment({
    stamp,
    report: { model: "claude-haiku", level: "live-ui-verified", rows: [{ id: "V1", check: "a|b", result: "PASS", evidence: "x\ny" }], notVerified: [] },
    checklist: [{ id: "V1", text: "" }, { id: "V2", text: "" }],
    problems: ["V2 没有对应的检查行"],
    claimed: "live-ui-verified",
    shots: [{ name: "home-375.png", url: "https://example.test/home-375.png" }],
    runUrl: "https://example.test/run",
  });
  const lines = receipt.split("\n");
  assert.deepEqual(lines.slice(0, 2), [`验证回执 ${HEAD}：verifier-blocked`, stampLine(stamp)]);
  assert.ok(lines.includes("| V1 | a\\|b | PASS | x<br>y |"));
  assert.match(receipt, /验证员自报 live-ui-verified，按清单对照改记 verifier-blocked/);
  assert.match(receipt, /<img src="https:\/\/example.test\/home-375.png"/);
  const judge = judgeComment({
    stamp: { sha: HEAD, verdict: "FAIL", body: digest },
    report: { model: "claude-opus", verdict: "FAIL", asks: [{ ask: "换位置", met: false, evidence: "没改" }], regressions: [], fixes: ["换位置"] },
    runUrl: "https://example.test/run",
  });
  assert.equal(judge.split("\n")[0], `判定 ${HEAD}：FAIL`);
  assert.match(judge, /\| 换位置 \| 否 \| 没改 \|/);
  const parsed = parseComments([{ user: { id: 338272049 }, body: receipt }, { user: { id: 338272049 }, body: judge }]);
  assert.deepEqual([parsed.receipt?.level, parsed.receipt?.body, parsed.judge?.verdict], ["verifier-blocked", digest, "FAIL"]);
});

test("shotLinks 只收安全文件名的 PNG，按名排序并转义", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "shots-"));
  for (const name of ["b-375.png", "a-1280.png", "notes.txt", "bad name.png"]) fs.writeFileSync(path.join(dir, name), "");
  assert.deepEqual(shotLinks(dir, "https://raw.test/d"), [
    { name: "a-1280.png", url: "https://raw.test/d/a-1280.png" },
    { name: "b-375.png", url: "https://raw.test/d/b-375.png" },
  ]);
  assert.deepEqual(shotLinks("", "https://raw.test/d"), []);
  fs.rmSync(dir, { recursive: true });
});

test("参数错抛成用法错误，主入口据此退出 2", async () => {
  for (const argv of [["plan"], ["plan", "--pr", "7", "--nope"], ["prompt", "--pr", "7", "--role", "x"], ["publish", "--pr", "7", "--head", "abc"], ["bogus", "--pr", "7"], ["plan", "--pr", "7", "--head", "x"], ["wait-preview", "--pr", "7", "--timeout-min", "0"], ["wait-preview", "--pr", "7", "--timeout-min", "abc"]]) {
    await assert.rejects(main(argv, async () => assert.fail("不该读 GitHub")), (error: Error) => error.constructor.name === "UsageError", argv.join(" "));
  }
});

test("bodyDigest：有原话时只看清单与原话，没原话时看全文，Devin 徽章不算", async () => {
  const withWords = "说明\n## 验证清单\n- V1：a\n## lyjw 原话\n> 要 a";
  assert.equal(await bodyDigest(withWords), await bodyDigest(withWords.replace("说明", "说明改了")));
  const plain = "要支持筛选\n## 验证清单\n- V1：a";
  assert.notEqual(await bodyDigest(plain), await bodyDigest(`${plain}\n还要支持导出`));
  const badge = "\n<!-- devin-review-badge-begin -->\n<a href=\"x\">Devin</a>\n<!-- devin-review-badge-end -->";
  assert.equal(await bodyDigest(plain), await bodyDigest(`${plain}${badge}`));
  assert.equal(await bodyDigest(withWords), await bodyDigest(`${withWords}${badge}`));
  assert.equal(await bodyDigest(withWords), await bodyDigest(`${withWords}\n\n---\n_Generated by Claude Code_`));
  assert.equal(parseBody(`${withWords}\n\n---\n_Generated by Claude Code_${badge}`).words, "> 要 a");
  const grouped = parseBody("## 验证清单\n- V1：a\n---\n- V2：b\n## lyjw 原话\n> 要 a\n\n---\n\n> 还要 b\n\n---\n_Generated by Claude Code_");
  assert.deepEqual(grouped.checklist.map((item) => item.id), ["V1", "V2"]);
  assert.equal(grouped.words, "> 要 a\n\n---\n\n> 还要 b");
});

test("judgeVerdict：自报 PASS 但有没做到或缺依据的要求、有回归、有待修项或没列要求，都按 FAIL 签", () => {
  const judge = (extra: object) => ({ model: "m", verdict: "PASS", asks: [{ ask: "a", met: true, evidence: "e" }], regressions: [], fixes: [], ...extra });
  assert.equal(judgeVerdict(judge({})), "PASS");
  assert.equal(judgeVerdict(judge({ asks: [{ ask: "a", met: false, evidence: "e" }] })), "FAIL");
  assert.equal(judgeVerdict(judge({ regressions: ["r"] })), "FAIL");
  assert.equal(judgeVerdict(judge({ asks: [] })), "FAIL");
  assert.equal(judgeVerdict(judge({ asks: [{ ask: "a", met: true, evidence: " " }] })), "FAIL");
  assert.equal(judgeVerdict(judge({ asks: [{ ask: "", met: true, evidence: "e" }] })), "FAIL");
  assert.equal(judgeVerdict(judge({ fixes: ["f"] })), "FAIL");
  const comment = judgeComment({ stamp: { sha: HEAD, verdict: "FAIL", body: "b".repeat(64) }, report: judge({ regressions: ["r"] }), runUrl: "u" });
  assert.match(comment, /判定员自报 PASS，.*改记 FAIL/);
});

test("staleRead：描述或目标分支在读之后改了、成功却没交回读到的版本都不签", () => {
  const current = "main@abc";
  assert.equal(staleRead(current, "success", current), false);
  assert.equal(staleRead("main@old", "success", current), true);
  assert.equal(staleRead("dev@abc", "failure", current), true);
  assert.equal(staleRead(undefined, "success", current), true);
  assert.equal(staleRead("", "failure", current), false);
});
