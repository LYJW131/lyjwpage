import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { addedLines, buildRequests, collect, findComments, report } from "./comment-check.ts";
import { loadTypeScript } from "./comment-only-check.ts";
import { COMMENT_CHECK, commentAdvice } from "./pr-gate/checks.ts";

const ts = loadTypeScript(process.cwd());

test("addedLines 按 -U0 的 hunk 头记下新文件里新增的行号", () => {
  const diff = ["diff --git a/x.ts b/x.ts", "--- a/x.ts", "+++ b/x.ts", "@@ -3,0 +4,2 @@", "+a", "+b", "@@ -9 +11 @@", "-c", "+d", "+++ /dev/null"].join("\n");
  assert.deepEqual([...(addedLines(diff).get("x.ts") ?? [])], [4, 5, 11]);
});

test("findComments 只取碰到新增行的注释，连续的 // 合成一条，指令性注释与字符串里的 // 不算", () => {
  const text = [
    "// 旧注释",
    "const url = \"https://x.dev\"; // 尾注释",
    "// eslint-disable-next-line no-console",
    "// 第一行",
    "// 第二行",
    "export const a = 1;",
  ].join("\n");
  const found = findComments(ts, "x.ts", text, new Set([2, 3, 5]));
  assert.deepEqual(found.map((item) => [item.line, item.endLine, item.comment]), [
    [2, 2, "// 尾注释"],
    [4, 5, "// 第一行\n// 第二行"],
  ]);
  assert.match(found[1]?.code ?? "", /export const a = 1;/);
});

test("buildRequests 每次请求的问题键是全局序号，注释下标按这一批算", () => {
  const found = Array.from({ length: 12 }, (_, i) => ({ file: "x.ts", line: i + 1, endLine: i + 1, comment: `// ${i}`, code: `// ${i}` }));
  const [first, second] = buildRequests(found);
  assert.equal(Object.keys(first?.questions ?? {}).length, 10);
  assert.deepEqual(Object.keys(second?.questions ?? {}), ["c10", "c11"]);
  assert.match(second?.questions.c11?.instructions ?? "", /comments\[1\]/);
});

test("report 只列 ≥0.7 的，调用失败时写明没有建议", () => {
  const item = { file: "x.ts", line: 3, endLine: 3, comment: "// 跑测试", code: "" };
  const result = report([{ ...item, p: 0.9 }, { ...item, line: 9, p: 0.5 }, { ...item, line: 12, p: 0.1 }]);
  assert.equal(result.flagged.length, 1);
  assert.match(result.summary, /x\.ts:3/);
  assert.doesNotMatch(result.summary, /x\.ts:9/);
  assert.match(report([{ ...item, p: null }], { error: "HTTP 500" }).title, /调用失败/);
});

test("commentAdvice 只在 neutral 时给建议", () => {
  const run = { name: COMMENT_CHECK, status: "completed", conclusion: "neutral", html_url: "https://github.com/x", output: { title: "2 条新注释可能该删" } };
  assert.match(commentAdvice([run]) ?? "", /2 条新注释可能该删.*https:\/\/github\.com\/x/);
  assert.equal(commentAdvice([{ ...run, conclusion: "success" }]), null);
  assert.equal(commentAdvice([]), null);
});

test("标注集每条都有该删与否的标签和代码上下文", () => {
  const cases = JSON.parse(readFileSync("scripts/comment-check-cases.json", "utf8")) as { comment: string; code: string; delete: unknown }[];
  assert.ok(cases.length > 0);
  for (const item of cases) {
    assert.equal(typeof item.delete, "boolean");
    assert.ok(item.code.includes(item.comment.split("\n")[0] ?? ""), item.comment);
  }
});

test("collect 跳过基准里原样有过的尾注释，只问真正新增的", async () => {
  const { mkdtempSync, writeFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const dir = mkdtempSync(join(tmpdir(), "comment-check-"));
  const run = (...args: string[]) => spawnSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { cwd: dir, encoding: "utf8" });
  run("init", "-q", "-b", "main");
  writeFileSync(join(dir, "x.ts"), "export const timeout = 1000; // 旧的约束说明\n");
  run("add", ".");
  run("commit", "-qm", "base");
  writeFileSync(join(dir, "x.ts"), "export const timeout = 2000; // 旧的约束说明\n// 新加的一条\nexport const b = 1;\n");
  run("commit", "-qam", "head");
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    assert.deepEqual(collect(ts, "HEAD^", "HEAD").map((item) => item.comment), ["// 新加的一条"]);
  } finally {
    process.chdir(cwd);
  }
});
