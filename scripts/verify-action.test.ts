import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { tierOf } from "./pr-gate/tier.ts";
import { judgeComment, parseBody, planOf, receiptComment, reconcile, shotLinks } from "./verify-action.ts";

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
  assert.equal(reconcile([], report([], "verifier-failed")).level, "verifier-failed");
});

test("planOf：草稿、已关闭与只改文档的不验，界面档等预览，逻辑档要判定", () => {
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
  assert.deepEqual([planOf(pull(), tierOf(["workers/core/src/a.ts"], trusted))].map((p) => [p.need, p.judge, p.ui]), [["unit-test-verified", true, false]]);
  assert.equal(planOf(pull(), tierOf(["docs/a.md"], trusted)).need, "");
  assert.equal(planOf(pull({ draft: true }), tierOf(["src/components/a.tsx"], trusted)).need, "");
  assert.equal(planOf(pull({ state: "closed" }), tierOf(["src/components/a.tsx"], trusted)).judge, false);
});

test("评论第一行就是签好的回执与判定行，表格里的竖线与换行被转义", () => {
  const firstLine = `验证回执 ${HEAD}：verifier-blocked`;
  const receipt = receiptComment({
    firstLine,
    report: { model: "claude-haiku", level: "live-ui-verified", rows: [{ id: "V1", check: "a|b", result: "PASS", evidence: "x\ny" }], notVerified: [] },
    checklist: [{ id: "V1", text: "" }, { id: "V2", text: "" }],
    problems: ["V2 没有对应的检查行"],
    claimed: "live-ui-verified",
    shots: [{ name: "home-375.png", url: "https://example.test/home-375.png" }],
    runUrl: "https://example.test/run",
  });
  const lines = receipt.split("\n");
  assert.equal(lines[0], firstLine);
  assert.ok(lines.includes("| V1 | a\\|b | PASS | x<br>y |"));
  assert.match(receipt, /验证员自报 live-ui-verified，按清单对照改记 verifier-blocked/);
  assert.match(receipt, /<img src="https:\/\/example.test\/home-375.png"/);
  const judge = judgeComment({
    firstLine: `判定 ${HEAD}：FAIL`,
    report: { model: "claude-opus", verdict: "FAIL", asks: [{ ask: "换位置", met: false, evidence: "没改" }], regressions: [], fixes: ["换位置"] },
    runUrl: "https://example.test/run",
  });
  assert.equal(judge.split("\n")[0], `判定 ${HEAD}：FAIL`);
  assert.match(judge, /\| 换位置 \| 否 \| 没改 \|/);
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
