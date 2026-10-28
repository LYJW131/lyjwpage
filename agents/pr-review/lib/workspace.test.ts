import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { gitSource } from "./git-source.js";
import { type PullTarget, fitDiff, reviewWorkspace } from "./workspace.js";

function repoWithChange() {
  const dir = mkdtempSync(join(tmpdir(), "pr-review-test-"));
  const git = (...args: string[]) => execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args], { encoding: "utf8" }).trim();
  git("init", "-q");
  writeFileSync(join(dir, "a.ts"), "export const a = 1;\n");
  writeFileSync(join(dir, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0]));
  git("add", ".");
  git("commit", "-qm", "base");
  const base = git("rev-parse", "HEAD");
  writeFileSync(join(dir, "a.ts"), "export const a = 2;\n");
  writeFileSync(join(dir, "b.ts"), "export const b = 1;\n");
  git("add", ".");
  git("commit", "-qm", "head");
  return { dir, base, head: git("rev-parse", "HEAD") };
}

test("本地 git 快照：diff 是 merge-base 起的改动，repo/ 是 head 的文本源码树，没开 PR 时 meta 写明", async () => {
  const { dir, base, head } = repoWithChange();
  const target: PullTarget = { owner: "o", repo: "r", title: "t", body: "intent", author: "a", baseSha: base, headSha: head };
  const files = await reviewWorkspace(gitSource(target, dir), target);
  assert.equal(files["repo/a.ts"], "export const a = 2;\n");
  assert.equal(files["repo/b.ts"], "export const b = 1;\n");
  assert.equal(files["repo/logo.png"], undefined);
  assert.match(files["pr/diff.patch"], /^-export const a = 1;$/m);
  assert.match(files["pr/diff.patch"], /^\+export const b = 1;$/m);
  assert.equal(files["pr/head.sha"], head);
  assert.match(files["pr/meta.md"], /^# Change \(pull request not opened yet\): t$/m);
  assert.match(files["pr/meta.md"], /^ {2}- b\.ts$/m);
  assert.match(files["pr/meta.md"], /intent/);
});

test("fitDiff 超限时按文件分摊：小文件的改动完整保留，锁文件只留文件头，大文件截短并注明", () => {
  const file = (path: string, lines: number) => `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n${"+x\n".repeat(lines)}`;
  const code = file("src/a.ts", 3);
  const diff = file("data/cases.json", 5000) + file("pnpm-lock.yaml", 2000) + code;
  const out = fitDiff(diff, 4000);
  assert.ok(out.includes(code));
  assert.match(out, /^diff --git a\/pnpm-lock\.yaml b\/pnpm-lock\.yaml\n…\[hunks omitted/m);
  assert.match(out, /…\[diff of this file cut here; read repo\/data\/cases\.json for the rest\]/);
  assert.ok(out.length < 4200);
  assert.equal(fitDiff(code, 4000), code);
});
