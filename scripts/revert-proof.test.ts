import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { isTestFile, prove, summarize, verdictOf } from "./revert-proof.ts";

const sh = (cwd: string, ...args: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.com", "-c", "commit.gpgsign=false", ...args], { cwd, encoding: "utf8" });

function repo(files: Record<string, string>) {
  const dir = mkdtempSync(path.join(tmpdir(), "revert-proof-test-"));
  sh(dir, "init", "-q", "-b", "main");
  for (const [file, text] of Object.entries(files)) writeFileSync(path.join(dir, file), text);
  sh(dir, "add", ".");
  sh(dir, "commit", "-q", "-m", "base");
  return dir;
}

function commit(dir: string, files: Record<string, string | null>) {
  for (const [file, text] of Object.entries(files)) {
    if (text === null) rmSync(path.join(dir, file));
    else writeFileSync(path.join(dir, file), text);
  }
  sh(dir, "add", "-A");
  sh(dir, "commit", "-q", "-m", "fix");
}

const TEST = `import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { add } from "./math.mjs";\ntest("add", () => assert.equal(add(1, 2), 3));\n`;
const cmd = "node --test math.test.mjs";

test("修复撤回后测试断言失败、HEAD 上通过：证明成立，当前工作区与 worktree 列表不变", () => {
  const dir = repo({ "math.mjs": "export const add = (a, b) => a - b;\n" });
  try {
    commit(dir, { "math.mjs": "export const add = (a, b) => a + b;\n", "math.test.mjs": TEST });
    const before = sh(dir, "worktree", "list");
    const proof = prove({ root: dir, tests: ["math.test.mjs"], base: "HEAD~1", cmd });
    assert.equal(proof.verdict, "proved");
    assert.deepEqual(proof.reverted, ["math.mjs"]);
    assert.equal(proof.red.assertion, true);
    assert.equal(proof.green?.exit, 0);
    assert.equal(sh(dir, "status", "--porcelain"), "");
    assert.equal(sh(dir, "worktree", "list"), before);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("测试没抓住 bug 判 not-red；修复落在新文件里也一样，并列进 addedKept", () => {
  const dir = repo({ "math.mjs": "export const add = (a, b) => a + b;\n" });
  try {
    commit(dir, { "helper.mjs": "export const x = 1;\n", "math.test.mjs": TEST });
    const proof = prove({ root: dir, tests: ["math.test.mjs"], base: "HEAD~1", cmd });
    assert.equal(proof.verdict, "not-red");
    assert.deepEqual(proof.addedKept, ["helper.mjs"]);
    assert.equal(proof.green, null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("修复删掉的文件在红的那次换回来、绿的那次删掉，不会整条失败", () => {
  const dir = repo({ "math.mjs": "export { add } from \"./old.mjs\";\n", "old.mjs": "export const add = (a, b) => a - b;\n" });
  try {
    commit(dir, { "math.mjs": "export const add = (a, b) => a + b;\n", "old.mjs": null, "math.test.mjs": TEST });
    const proof = prove({ root: dir, tests: ["math.test.mjs"], base: "HEAD~1", cmd });
    assert.equal(proof.verdict, "proved");
    assert.deepEqual(proof.reverted.sort(), ["math.mjs", "old.mjs"]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("红了但不是断言失败（导入出错、零个测试）不算证明", () => {
  const importError = summarize(1, "Error [ERR_MODULE_NOT_FOUND]: Cannot find module\n# tests 1\n# fail 1");
  assert.equal(verdictOf(importError, null).verdict, "red-not-assertion");
  const noTests = summarize(1, "AssertionError\n# tests 0");
  assert.equal(verdictOf(noTests, null).verdict, "red-not-assertion");
  const red = summarize(1, "AssertionError [ERR_ASSERTION]\n# tests 1");
  assert.equal(verdictOf(red, summarize(1, "# tests 1\n# fail 1")).verdict, "not-green");
});

test("测试文件、夹具与 --keep 指定的文件不换回基线", () => {
  const keep = new Set(["src/lib/helper.ts"]);
  assert.equal(isTestFile("src/lib/x.test.mts", keep), true);
  assert.equal(isTestFile("workers/core/dev-fixtures/a.json", keep), false);
  assert.equal(isTestFile("scripts/fixtures/a.json", keep), true);
  assert.equal(isTestFile("src/lib/helper.ts", keep), true);
  assert.equal(isTestFile("src/lib/x.ts", keep), false);
});
