import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

import { blameCounts, isReworkSubject, prNumber, removedRanges, reworkCandidates } from "./rework-candidates.ts";

const SCRIPT = fileURLToPath(new URL("./rework-candidates.ts", import.meta.url));
const GIT_ENV = { ...(Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))) as NodeJS.ProcessEnv), GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };

function tempRepo(t: TestContext) {
  const dir = mkdtempSync(path.join(os.tmpdir(), "rework-candidates-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (at: string | null, ...args: string[]) => {
    const env = at ? { ...GIT_ENV, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at } : GIT_ENV;
    const result = spawnSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.com", "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", ...args], { cwd: dir, env, encoding: "utf8" });
    assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stderr}`);
    return result.stdout.trim();
  };
  const write = (file: string, lines: string[]) => writeFileSync(path.join(dir, file), `${lines.join("\n")}\n`);
  const commit = (at: string, message: string) => {
    git(null, "add", "-A");
    git(at, "commit", "-q", "-m", message);
    return git(null, "rev-parse", "HEAD");
  };
  const merge = (at: string, branch: string, message: string) => {
    git(at, "merge", "-q", "--no-ff", "-m", message, branch);
    return git(null, "rev-parse", "HEAD");
  };
  git(null, "init", "-q");
  return { dir, git, write, commit, merge };
}

const numbered = (prefix: string) => Array.from({ length: 10 }, (_, i) => `${prefix}${i + 1}`);
const edit = (lines: string[], changes: Record<number, string>) => lines.map((line, i) => changes[i + 1] ?? line);

function history(t: TestContext) {
  const repo = tempRepo(t);
  const { git, write, commit, merge } = repo;
  let a = numbered("a");
  let b = numbered("b");
  let c = numbered("c");
  write("a.txt", a);
  write("b.txt", b);
  write("c.txt", c);
  commit("2026-10-01T10:00:00+08:00", "chore: 初始");

  git(null, "checkout", "-q", "-b", "old");
  b = edit(b, { 2: "b2 old", 7: "b7 old" });
  write("b.txt", b);
  commit("2026-10-10T09:00:00+08:00", "feat(b): 老功能");
  git(null, "checkout", "-q", "main");
  const pr2 = merge("2026-10-10T12:00:00+08:00", "old", "feat(b): 老功能 (#2)");

  git(null, "checkout", "-q", "-b", "feat");
  a = edit(a, { 3: "a3 feat", 4: "a4 feat", 5: "a5 feat" });
  write("a.txt", a);
  commit("2026-10-12T09:00:00+08:00", "feat(a): 加功能");
  git(null, "checkout", "-q", "main");
  const pr1 = merge("2026-10-15T10:00:00+08:00", "feat", "feat(a): 加功能 (#1)");

  mkdirSync(path.join(repo.dir, "vendor"));
  git(null, "update-index", "--add", "--cacheinfo", `160000,${git(null, "rev-parse", "HEAD")},vendor`);
  const pushed = edit(c, { 5: "c5 pushed" });
  write("c.txt", pushed);
  git(null, "add", "c.txt");
  git("2026-10-16T08:00:00+08:00", "commit", "-q", "-m", "feat(c): 直推加行");
  const direct = git(null, "rev-parse", "HEAD");

  git(null, "checkout", "-q", "-b", "fix");
  a = edit(a, { 3: "a3 fixed", 4: "a4 fixed" });
  b = edit(b, { 2: "b2 fixed" });
  write("a.txt", a);
  write("b.txt", b);
  write("c.txt", [...pushed, "c11 added", "c12 added"]);
  write("d.txt", ["new file"]);
  commit("2026-10-16T11:00:00+08:00", "fix(a): 修功能");
  git(null, "checkout", "-q", "main");
  const pr3 = merge("2026-10-16T12:00:00+08:00", "fix", "fix(a): 修功能 (#3)");

  git(null, "rm", "-q", "--cached", "vendor");
  c = [...c, "c11 added", "c12 added"];
  write("c.txt", c);
  const revert = commit("2026-10-16T20:00:00+08:00", 'Revert "feat(c): 直推加行"');

  a = [...a.slice(0, 3), "a3.5 inserted", ...a.slice(3)];
  write("a.txt", a);
  const additions = commit("2026-10-17T08:00:00+08:00", "fix: 只加行");

  write("c.txt", edit(c, { 11: "c11 feat" }));
  commit("2026-10-17T09:00:00+08:00", "feat(c): 不是修复的改动");

  a = a.map((line) => (line === "a5 feat" ? "a5 late" : line));
  b = edit(b, { 7: "b7 late" });
  write("a.txt", a);
  write("b.txt", b);
  const late = commit("2026-10-17T11:00:00+08:00", "fix(b): 超出窗口 (#4)");

  return { repo, direct, pr1, pr2, pr3, revert, additions, late };
}

const summary = (pairs: ReturnType<typeof reworkCandidates>["pairs"]) =>
  pairs.map((pair) => ({ rework: pair.rework.sha, reworked: pair.reworked.sha, files: pair.files }));

test("主题判定：fix 与 revert 的各种写法算，fix 出现在别处不算；PR 号取标题末尾的 (#N)", () => {
  for (const subject of ["fix(site): x (#1)", "fix: x", "fix!: x", "Fix(ai,core): x", 'Revert "feat: x (#2)"', "revert(site): x", "revert: x"]) {
    assert.ok(isReworkSubject(subject), subject);
  }
  for (const subject of ["feat: fix x", "fixup! fix: x", "chore: revert x", "fixes: x", "refactor(fix): x"]) {
    assert.ok(!isReworkSubject(subject), subject);
  }
  assert.equal(prNumber("fix(site): x (#431)"), 431);
  assert.equal(prNumber("fix(site): 见 (#12) 的说明"), null);
});

test("removedRanges 只取有旧行的 hunk，省略行数的按 1 行", () => {
  assert.deepEqual(removedRanges("@@ -3,2 +3,2 @@\n-x\n-y\n+x\n+y\n@@ -9,0 +10,2 @@\n+z\n@@ -20 +21 @@ ctx\n--- a/not-a-header\n"), [[3, 2], [20, 1]]);
});

test("blameCounts 按提交数行，标了 boundary 的提交不计", () => {
  const one = "1".repeat(40);
  const two = "2".repeat(40);
  const porcelain = [`${one} 1 1 2`, "author A", "summary x", "filename f", "\tline", `${one} 2 2`, "\tline", `${two} 5 3 1`, "boundary", "filename f", `\t${one} 9 9`].join("\n");
  assert.deepEqual([...blameCounts(porcelain)], [[one, 2]]);
});

test("2 天内的合并与直推被修就列出；超出窗口、只加行、新文件、子模块和不是修复的提交都不列", (t) => {
  const { repo, direct, pr1, pr3, revert, additions } = history(t);
  const result = reworkCandidates({ repo: repo.dir, from: direct, to: "main", windowHours: 48 });
  assert.equal(result.fixes, 4);
  assert.equal(result.withoutCandidates, 2);
  assert.deepEqual(summary(result.pairs), [
    { rework: pr3, reworked: pr1, files: [{ path: "a.txt", lines: 2 }] },
    { rework: revert, reworked: direct, files: [{ path: "c.txt", lines: 1 }] },
  ]);
  const [merged, reverted] = result.pairs;
  assert.equal(merged.rework.pr, 3);
  assert.equal(merged.reworked.pr, 1);
  assert.equal(merged.reworked.shanghai, "2026-10-15 10:00");
  assert.equal(merged.reworked.committedAt, "2026-10-15T02:00:00.000Z");
  assert.equal(merged.reworked.hoursBefore, 26);
  assert.equal(merged.lines, 2);
  assert.equal(reverted.rework.subject, 'Revert "feat(c): 直推加行"');
  assert.equal(reverted.reworked.pr, null);
  assert.ok(!result.pairs.some((pair) => pair.rework.sha === additions));
});

test("窗口放宽后，老合并与刚出窗口的那次也算进来", (t) => {
  const { repo, direct, pr1, pr2, pr3, revert, late } = history(t);
  const result = reworkCandidates({ repo: repo.dir, from: direct, to: "main", windowHours: 24 * 30 });
  assert.equal(result.withoutCandidates, 1);
  assert.deepEqual(summary(result.pairs), [
    { rework: pr3, reworked: pr1, files: [{ path: "a.txt", lines: 2 }] },
    { rework: pr3, reworked: pr2, files: [{ path: "b.txt", lines: 1 }] },
    { rework: revert, reworked: direct, files: [{ path: "c.txt", lines: 1 }] },
    { rework: late, reworked: pr1, files: [{ path: "a.txt", lines: 1 }] },
    { rework: late, reworked: pr2, files: [{ path: "b.txt", lines: 1 }] },
  ]);
});

test("命令行：输出 JSON；缺参数、未知选项、窗口不是正数、认不出的提交退出 2", (t) => {
  const { repo, direct } = history(t);
  const run = (...args: string[]) => spawnSync(process.execPath, ["--experimental-strip-types", SCRIPT, ...args], { cwd: repo.dir, encoding: "utf8" });
  const ok = run("--from", direct, "--to", "main");
  assert.equal(ok.status, 0, ok.stderr);
  assert.equal(JSON.parse(ok.stdout).pairs.length, 2);
  for (const args of [["--from", direct], ["--from", direct, "--to", "main", "--nope"], ["--from", direct, "--to", "main", "--window-hours", "0"], ["--from", "nope", "--to", "main"]]) {
    assert.equal(run(...args).status, 2, args.join(" "));
  }
});
