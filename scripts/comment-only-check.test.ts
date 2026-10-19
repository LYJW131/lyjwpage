import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import { checkFiles, compareContents } from "./comment-only-check.ts";

const SCRIPT = fileURLToPath(new URL("./comment-only-check.ts", import.meta.url));
const status = (file: string, before: string | null, after: string | null, options: { loose?: boolean } = {}) => compareContents({ ts, file, before, after, ...options }).status;

test("结论：内容相同、新增、已删除、不支持的类型", () => {
  assert.equal(status("a.ts", "export const a = 1;\n", "export const a = 1;\n"), "unchanged");
  assert.equal(status("a.ts", null, "export const a = 1;\n"), "new");
  assert.equal(status("a.ts", "export const a = 1;\n", null), "deleted");
  assert.equal(status("a.py", "x = 1\n", "x = 2\n"), "unsupported");
});

function tempRepo() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "comment-only-test-"));
  const run = (...args: string[]) => {
    const result = spawnSync("git", args, { cwd: dir, encoding: "utf8" });
    assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stderr}`);
    return result.stdout;
  };
  run("init", "-q");
  run("config", "user.email", "t@example.com");
  run("config", "user.name", "t");
  run("config", "commit.gpgsign", "false");
  return {
    dir,
    run,
    write: (name: string, text: string) => writeFileSync(path.join(dir, name), text),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

test("按 git 里的版本比较：工作区对基准、两个提交之间、基准里没有的算新增、删掉的算已删除", () => {
  const repo = tempRepo();
  try {
    repo.write("only-comments.ts", "export const a = 1; // 旧\n");
    repo.write("code-changed.ts", "export const n = 185; // 分钟\n");
    repo.write("untouched.ts", "export const u = 1;\n");
    repo.run("add", "-A");
    repo.run("commit", "-q", "-m", "base");

    repo.write("only-comments.ts", "// 头\nexport const a = 1; // 新\n");
    repo.write("code-changed.ts", "export const n = 186; // 分钟\n");
    repo.write("brand-new.ts", "export const b = 1;\n");
    repo.run("add", "-N", "brand-new.ts");
    const files = ["only-comments.ts", "code-changed.ts", "untouched.ts", "brand-new.ts"];
    assert.deepEqual(checkFiles({ repo: repo.dir, files, ts }).map((row) => row.status), ["comment-only", "code", "unchanged", "new"]);

    repo.run("add", "-A");
    repo.run("commit", "-q", "-m", "after");
    const between = checkFiles({ repo: repo.dir, base: "HEAD~1", to: "HEAD", files: files.slice(0, 3), ts });
    assert.deepEqual(between.map((row) => row.status), ["comment-only", "code", "unchanged"]);

    rmSync(path.join(repo.dir, "untouched.ts"));
    assert.equal(checkFiles({ repo: repo.dir, files: ["untouched.ts"], ts })[0].status, "deleted");
  } finally {
    repo.cleanup();
  }
});

test("命令行：有除注释外的改动退出码为 1 并点名文件、附差异，只有注释改动为 0，--to 比两个提交", () => {
  const repo = tempRepo();
  try {
    repo.write("only-comments.ts", "export const a = 1;\n");
    repo.write("code-changed.ts", "export const n = 185;\n");
    repo.run("add", "-A");
    repo.run("commit", "-q", "-m", "base");
    repo.write("only-comments.ts", "// 说明\nexport const a = 1;\n");
    repo.write("code-changed.ts", "export const n = 186;\n");
    const cli = (...args: string[]) => spawnSync(process.execPath, [SCRIPT, "--repo", repo.dir, ...args], { cwd: repo.dir, encoding: "utf8" });

    const fine = cli("only-comments.ts");
    assert.equal(fine.status, 0, fine.stderr);
    assert.match(fine.stdout, /共 1 个文件：仅注释 1，没变化 0，需要看 0/);

    const bad = cli();
    assert.equal(bad.status, 1, bad.stderr);
    assert.match(bad.stdout, /除注释外有改动\s+code-changed\.ts/);
    assert.match(bad.stdout, /去注释后·基准/);
    assert.match(bad.stdout, /共 2 个文件：仅注释 1，没变化 0，需要看 1/);

    repo.run("add", "-A");
    repo.run("commit", "-q", "-m", "after");
    assert.equal(cli("--base", "HEAD~1", "--to", "HEAD", "only-comments.ts").status, 0);
    assert.equal(cli("--base", "HEAD~1", "--to", "HEAD", "code-changed.ts").status, 1);
    assert.match(cli("--base", "HEAD~1", "--to", "HEAD").stdout, /共 2 个文件/);
  } finally {
    repo.cleanup();
  }
});

test("命令行：指令性注释挪了位置，退出码为 1，逐条列出基准与当前的绑定", () => {
  const repo = tempRepo();
  try {
    repo.write("moved.ts", '// @ts-ignore\nconst a: number = "x";\nconst b: number = "y";\n');
    repo.write("moved.swift", "// swiftlint:disable:next type_name\nstruct a {}\nstruct b {}\n");
    repo.run("add", "-A");
    repo.run("commit", "-q", "-m", "base");
    repo.write("moved.ts", 'const a: number = "x";\n// @ts-ignore\nconst b: number = "y";\n');
    repo.write("moved.swift", "struct a {}\n// swiftlint:disable:next type_name\nstruct b {}\n");
    const result = spawnSync(process.execPath, [SCRIPT, "--repo", repo.dir], { cwd: repo.dir, encoding: "utf8" });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /指令性注释有改动\s+moved\.ts/);
    assert.match(result.stdout, /指令性注释有改动\s+moved\.swift/);
    assert.match(result.stdout, /基准：\n\s+\/\/ @ts-ignore .*下一行「const a: number = "x";」/);
    assert.match(result.stdout, /当前：\n\s+\/\/ @ts-ignore .*下一行「const b: number = "y";」/);
    assert.match(result.stdout, /共 2 个文件：仅注释 0，没变化 0，需要看 2/);
  } finally {
    repo.cleanup();
  }
});

test("命令行：没有可比较的文件为 0，不认识的选项与缺值的选项为 2，--help 打印文件头里的用法", () => {
  const repo = tempRepo();
  try {
    repo.write("notes.txt", "a\n");
    repo.run("add", "-A");
    repo.run("commit", "-q", "-m", "base");
    repo.write("notes.txt", "b\n");
    const none = spawnSync(process.execPath, [SCRIPT, "--repo", repo.dir], { cwd: repo.dir, encoding: "utf8" });
    assert.equal(none.status, 0, none.stderr);
    assert.match(none.stdout, /没有可比较的/);
  } finally {
    repo.cleanup();
  }
  const unknown = spawnSync(process.execPath, [SCRIPT, "--nope"], { encoding: "utf8" });
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /不认识的选项 --nope/);
  for (const args of [["--base"], ["--to", "--loose"], ["--context"]]) {
    const missing = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
    assert.equal(missing.status, 2, args.join(" "));
    assert.match(missing.stderr, /后面缺值/);
  }
  const help = spawnSync(process.execPath, [SCRIPT, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /pnpm docs:comment-only/);
  assert.match(help.stdout, /已知局限/);
});
