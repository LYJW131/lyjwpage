import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import ts from "typescript";

import { checkFiles, compareContents, stripSwift } from "./comment-only-check.mjs";

const SCRIPT = fileURLToPath(new URL("./comment-only-check.mjs", import.meta.url));
const status = (file, before, after, options = {}) => compareContents({ ts, file, before, after, ...options }).status;

// 每个用例：[说明, 文件名（只看扩展名）, 基准内容, 改后内容, 期望结论]
const CASES = [
  ["TS：加、改、删注释，代码不动", "a.ts",
    `export const a = 1; // 旧注释\nfunction f(x: number) {\n  return x + 1;\n}\n`,
    `/** 新的说明 */\nexport const a = 1;\n/* 块注释 */\nfunction f(x: number) {\n  // 加一行\n  return x + 1; // 尾注释\n}\n`,
    "comment-only"],
  ["TS：字符串、模板、正则里的 // 和 /* 不算注释", "a.ts",
    `const url = "http://x.dev/a"; const re = /\\/\\*x\\*\\//; const t = \`a // b \${1 /* i */}\`;\nexport { url, re, t };\n`,
    `// 头\nconst url = "http://x.dev/a"; const re = /\\/\\*x\\*\\//; const t = \`a // b \${1}\`; // 尾\nexport { url, re, t };\n`,
    "comment-only"],
  ["TS：字符串内容变了", "a.ts",
    `export const url = "http://x.dev/a";\n`,
    `export const url = "http://x.dev/b"; // 改了字符串\n`,
    "code"],
  ["TS：数字变了（注释里的数字不算）", "a.ts",
    `export const limit = 185; // 分钟\n`,
    `export const limit = 186; // 分钟\n`,
    "code"],
  ["TS：新增 @ts-expect-error 是指令性注释", "a.ts",
    `export const a: number = 1;\n`,
    `// @ts-expect-error 故意\nexport const a: number = 1;\n`,
    "directive"],
  ["TS：新增 eslint-disable 是指令性注释", "a.ts",
    `export const a = 1;\n`,
    `// eslint-disable-next-line no-console\nexport const a = 1;\n`,
    "directive"],
  ["TS：单行对象改成多行对象，printer 认为形状变了，宁可让人看一眼", "a.ts",
    `export const o = { a: 1, b: 2 };\n`,
    `export const o = {\n  a: 1,\n  b: 2,\n};\n`,
    "code"],
  ["TSX：只加了 JSX 里的注释表达式", "view.tsx",
    `export function V() {\n  return (\n    <div>\n      <a href="http://x.dev">http://x.dev</a>\n      <b />\n    </div>\n  );\n}\n`,
    `export function V() {\n  return (\n    <div>\n      {/* 链接 */}\n      <a href="http://x.dev">http://x.dev</a>\n      {/* 粗体 */}\n      <b />\n    </div>\n  );\n}\n`,
    "comment-only"],
  ["TSX：JSX 文本变了", "view.tsx",
    `export const V = () => <p>a {"b"} c</p>;\n`,
    `export const V = () => <p>a {"b"} d</p>;\n`,
    "code"],
  ["JS：shebang 之后加注释", "script.mjs",
    `#!/usr/bin/env node\nconsole.log("hi");\n`,
    `#!/usr/bin/env node\n// 说明\nconsole.log("hi");\n`,
    "comment-only"],
  ["JS：换了 shebang 是指令性注释变了", "script.mjs",
    `#!/usr/bin/env node\nconsole.log("hi");\n`,
    `#!/usr/bin/env bun\nconsole.log("hi");\n`,
    "directive"],
  ["JS：带类型的 JSDoc 变了（checkJs 会读）", "jsdoc.js",
    `/** @param {string} a */\nexport const f = (a) => a;\n`,
    `/** @param {number} a */\nexport const f = (a) => a;\n`,
    "directive"],
  ["TS：改坏成语法错误", "broken.ts",
    `export const a = 1;\n`,
    `export const a = ;\n`,
    "parse-error"],
  ["Swift：加、改、删注释（含嵌套块注释）", "comments.swift",
    `import Foundation\n\n// 头\nstruct A {\n    let x = 1 // 尾\n    /* 块 /* 嵌套 */ 还在块里 */\n    func f() -> Int { x }\n}\n`,
    `import Foundation\n\n/// 新的文档注释\nstruct A {\n    let x = 1\n    func f() -> Int { x } // 说明\n}\n`,
    "comment-only"],
  ["Swift：字符串、原始字符串、多行字符串、插值里的 // 不算注释", "strings.swift",
    `let url = "http://example.com/a" // c\nlet raw = #"a // b "quoted" c"#\nlet multi = """\n  // 不是注释\n  /* 也不是 */\n  """\nlet interp = "\\(dict["a//b"]) tail" // c\n`,
    `// 头\nlet url = "http://example.com/a"\nlet raw = #"a // b "quoted" c"#  /* 尾 */\nlet multi = """\n  // 不是注释\n  /* 也不是 */\n  """\nlet interp = "\\(dict["a//b"]) tail"\n`,
    "comment-only"],
  ["Swift：字符串内容变了", "string-changed.swift",
    `let url = "http://example.com/a"\n`,
    `let url = "http://example.com/b" // 改了\n`,
    "code"],
  ["Swift：空白位置变了不是排版（a - b 与 a -b）", "operator.swift",
    `let z = a - b\n`,
    `let z = a -b // 空白位置变了，Swift 里这不是排版\n`,
    "code"],
  ["Swift：新增 swiftlint 指令", "lint.swift",
    `struct A {}\n`,
    `// swiftlint:disable type_name\nstruct A {}\n`,
    "directive"],
];

for (const [title, file, before, after, wanted] of CASES) {
  test(`结论：${title}`, () => {
    assert.equal(status(file, before, after), wanted);
  });
}

test("结论：内容相同、新增、已删除、不支持的类型", () => {
  assert.equal(status("a.ts", "export const a = 1;\n", "export const a = 1;\n"), "unchanged");
  assert.equal(status("a.ts", null, "export const a = 1;\n"), "new");
  assert.equal(status("a.ts", "export const a = 1;\n", null), "deleted");
  assert.equal(status("a.py", "x = 1\n", "x = 2\n"), "unsupported");
});

test("--loose：Swift 去掉全部空白再比，a - b 与 a -b 就分不出来了", () => {
  const before = "let z = a - b\n";
  const after = "let z = a -b // 空白位置变了\n";
  assert.equal(status("a.swift", before, after), "code");
  assert.equal(status("a.swift", before, after, { loose: true }), "comment-only");
});

test("stripSwift：块注释可以嵌套，行注释到行尾", () => {
  const { code, comments } = stripSwift("let a = 1 // 尾\n/* 外 /* 内 */ 还在外层里 */ let b = 2\n");
  assert.deepEqual(comments, ["// 尾", "/* 外 /* 内 */ 还在外层里 */"]);
  assert.equal(code.replace(/\s+/g, " ").trim(), "let a = 1 let b = 2");
});

test("stripSwift：字符串里的 // 和 /* 原样留在代码里", () => {
  const source = 'let url = "http://x.dev" // c\nlet raw = #"a // b "q" c"#\nlet multi = """\n  // 不是注释\n  /* 也不是 */\n  """\nlet s = "\\(dict["a//b"]) tail"\n';
  const { code, comments } = stripSwift(source);
  assert.deepEqual(comments, ["// c"]);
  for (const kept of ['"http://x.dev"', '#"a // b "q" c"#', "// 不是注释", "/* 也不是 */", '"a//b"']) {
    assert.ok(code.includes(kept), `代码里应保留 ${kept}`);
  }
});

test("已知局限：Swift 正则字面量里的 // 会被当成行注释（文件头有说明）", () => {
  const { code, comments } = stripSwift("let re = #/a//b/#\nlet x = 1\n");
  assert.deepEqual(comments, ["//b/#"]);
  assert.ok(code.includes("let x = 1"));
});

/** 临时 git 仓库：关掉提交签名，用例里的提交不依赖本机的签名配置 */
function tempRepo() {
  const dir = mkdtempSync(path.join(os.tmpdir(), "comment-only-test-"));
  const run = (...args) => {
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
    write: (name, text) => writeFileSync(path.join(dir, name), text),
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
    const cli = (...args) => spawnSync(process.execPath, [SCRIPT, "--repo", repo.dir, ...args], { cwd: repo.dir, encoding: "utf8" });

    const fine = cli("only-comments.ts");
    assert.equal(fine.status, 0, fine.stderr);
    assert.match(fine.stdout, /共 1 个文件：仅注释 1，没变化 0，需要看 0/);

    // 不给文件：取 diff 里扩展名认识的那些
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

test("命令行：没有可比较的文件为 0，不认识的选项为 2，--help 打印文件头里的用法", () => {
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
  const help = spawnSync(process.execPath, [SCRIPT, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /pnpm docs:comment-only/);
  assert.match(help.stdout, /已知局限/);
});
