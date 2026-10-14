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

  ["Swift：字符串里多了一个空格（\"a b\" → \"a  b\"）", "space.swift",
    `let s = "a b"\n`,
    `let s = "a  b" // 多了一个空格\n`,
    "code"],
  ["Swift：多行字符串里多了一个空行", "multiline-blank.swift",
    `let s = """\n  a\n  b\n  """\n`,
    `let s = """\n  a\n\n  b\n  """\n`,
    "code"],
  ["Swift：多行字符串里某一行的缩进变了", "multiline-indent.swift",
    `let s = """\n  a\n  b\n  """\n`,
    `let s = """\n  a\n    b\n  """\n`,
    "code"],
  ["Swift：多行字符串的行尾多了空白", "multiline-trailing.swift",
    `let s = """\n  a\n  b\n  """\n`,
    `let s = """\n  a   \n  b\n  """\n`,
    "code"],
  ["Swift：原始字符串里的空白变了", "raw-space.swift",
    `let s = #"a b"#\n`,
    `let s = #"a  b"#\n`,
    "code"],
  ["Swift：带插值的字符串里的空白变了", "interp-space.swift",
    `let s = "x \\(a) y"\n`,
    `let s = "x  \\(a) y"\n`,
    "code"],
  ["Swift：字符串之外的空白、换行前后的空白仍不算改动", "code-space.swift",
    `let a  =  foo( "a b" )   \n\n\nlet c = "c d"\n`,
    `let a = foo( "a b" ) // 说明\nlet c = "c d"\n`,
    "comment-only"],
  ["TS：字符串里多了一个空格", "string-space.ts",
    `export const s = "a b";\n`,
    `export const s = "a  b"; // 多了一个空格\n`,
    "code"],
  ["TS：模板字符串里的空白变了", "template-space.ts",
    `export const s = \`a b\n c\`;\n`,
    `export const s = \`a  b\n c\`;\n`,
    "code"],
  ["TS：正则字面量里的空白变了", "regex-space.ts",
    `export const re = /a b/;\n`,
    `export const re = /a  b/;\n`,
    "code"],
  ["TSX：JSX 属性字符串里的空白变了", "attr-space.tsx",
    `export const V = () => <a title="a b" />;\n`,
    `export const V = () => <a title="a  b" />;\n`,
    "code"],

  ["TS：@ts-ignore 挪到另一条语句前", "ignore-moved.ts",
    `// @ts-ignore\nconst a: number = "x";\nconst b: number = "y";\n`,
    `const a: number = "x";\n// @ts-ignore\nconst b: number = "y";\n`,
    "directive"],
  ["TS：@ts-expect-error 挪到另一条语句前", "expect-error-moved.ts",
    `// @ts-expect-error 故意\nconst a: number = "x";\nconst b: number = 1;\n`,
    `const a: number = "x";\n// @ts-expect-error 故意\nconst b: number = 1;\n`,
    "directive"],
  ["TS：两条一模一样的语句，@ts-ignore 挪到第二条", "twins.ts",
    `// @ts-ignore\nfoo(bad);\nfoo(bad);\n`,
    `foo(bad);\n// @ts-ignore\nfoo(bad);\n`,
    "directive"],
  ["TS：三斜线写法的 @ts-ignore 也是指令", "triple-slash.ts",
    `const a: number = "x";\n`,
    `/// @ts-ignore\nconst a: number = "x";\n`,
    "directive"],
  ["TS：JSDoc 写法的 @ts-ignore 也是指令", "jsdoc-ignore.ts",
    `const a: number = "x";\n`,
    `/** @ts-ignore */\nconst a: number = "x";\n`,
    "directive"],
  ["TSX：JSDoc 写法的 @jsxImportSource 改了", "pragma.tsx",
    `/** @jsxImportSource react */\nexport const V = () => <p />;\n`,
    `/** @jsxImportSource preact */\nexport const V = () => <p />;\n`,
    "directive"],
  ["TS：@ts-nocheck 从文件头挪到语句之后", "nocheck.ts",
    `// @ts-nocheck\nconst a: number = "x";\n`,
    `const a: number = "x";\n// @ts-nocheck\n`,
    "directive"],
  ["TS：eslint-disable-next-line 与目标行之间多了空行", "next-line-blank.ts",
    `// eslint-disable-next-line no-console\nconsole.log(1);\n`,
    `// eslint-disable-next-line no-console\n\nconsole.log(1);\n`,
    "directive"],
  ["TS：eslint-disable-next-line 与目标行之间多了一行普通注释", "next-line-comment.ts",
    `// eslint-disable-next-line no-console\nconsole.log(1);\n`,
    `// eslint-disable-next-line no-console\n// 说明\nconsole.log(1);\n`,
    "directive"],
  ["TS：eslint-disable-line 从行尾挪到独占一行", "line-moved.ts",
    `foo(); // eslint-disable-line no-console\nbar();\n`,
    `foo();\n// eslint-disable-line no-console\nbar();\n`,
    "directive"],
  ["TS：eslint-disable / eslint-enable 的区间挪动", "region.ts",
    `/* eslint-disable no-console */\nconsole.log(1);\n/* eslint-enable no-console */\nconsole.log(2);\n`,
    `/* eslint-disable no-console */\nconsole.log(1);\nconsole.log(2);\n/* eslint-enable no-console */\n`,
    "directive"],
  ["TS：/*#__PURE__*/ 挪到另一个调用前", "pure-moved.ts",
    `export const a = /*#__PURE__*/ f();\nexport const b = g();\n`,
    `export const a = f();\nexport const b = /*#__PURE__*/ g();\n`,
    "directive"],
  ["JS：带类型的 JSDoc 挪到另一个声明前", "jsdoc-moved.js",
    `/** @param {string} a */\nexport const f = (a) => a;\nexport const g = (a) => a;\n`,
    `export const f = (a) => a;\n/** @param {string} a */\nexport const g = (a) => a;\n`,
    "directive"],
  ["TSX：指令没动，别处的注释、空行、分号、JSX 注释表达式变了", "stable.tsx",
    `// 头部\nconst n = 1\n// @ts-expect-error 故意\nconst a: number = "x";\nexport const V = () => (\n  <div>\n    <b />\n  </div>\n);\n// @ts-ignore\nexport const late: number = "y";\n`,
    `// 头部（改写）\n\nconst n = 1; // 尾注释\n/* 新加的块注释 */\n// @ts-expect-error 故意\nconst a: number = "x";\nexport const V = () => (\n  <div>\n    {/* 新加的 JSX 注释 */}\n    <b />\n  </div>\n);\n\n// @ts-ignore\nexport const late: number = "y";\n`,
    "comment-only"],
  ["Swift：swiftlint 指令挪到另一个声明前", "lint-moved.swift",
    `// swiftlint:disable:next type_name\nstruct a {}\nstruct b {}\n`,
    `struct a {}\n// swiftlint:disable:next type_name\nstruct b {}\n`,
    "directive"],
  ["Swift：swiftlint:disable:next 与目标行之间多了空行", "lint-gap.swift",
    `// swiftlint:disable:next type_name\nstruct a {}\n`,
    `// swiftlint:disable:next type_name\n\nstruct a {}\n`,
    "directive"],
  ["Swift：两条一模一样的语句，swiftlint 指令挪到第二条", "lint-twins.swift",
    `// swiftlint:disable:next force_try\ntry! load()\ntry! load()\n`,
    `try! load()\n// swiftlint:disable:next force_try\ntry! load()\n`,
    "directive"],
  ["Swift：swiftlint 指令改了规则名", "lint-rule.swift",
    `// swiftlint:disable:next type_name\nstruct a {}\n`,
    `// swiftlint:disable:next identifier_name\nstruct a {}\n`,
    "directive"],
  ["TS：eslint-disable-next-line 改了规则名", "rule.ts",
    `// eslint-disable-next-line no-console\nconsole.log(1);\n`,
    `// eslint-disable-next-line no-alert\nconsole.log(1);\n`,
    "directive"],
  ["Swift：/// 写法的 swiftlint 指令也是指令", "lint-doc.swift",
    `struct a {}\n`,
    `/// swiftlint:disable type_name\nstruct a {}\n`,
    "directive"],
  ["Swift：swiftlint:disable:this 从行尾挪到下一行", "lint-this.swift",
    `let a = 1 // swiftlint:disable:this identifier_name\nlet b = 2\n`,
    `let a = 1\nlet b = 2 // swiftlint:disable:this identifier_name\n`,
    "directive"],
  ["Swift：swiftlint:disable / enable 的区间挪动", "lint-region.swift",
    `// swiftlint:disable identifier_name\nlet a = 1\n// swiftlint:enable identifier_name\nlet b = 2\n`,
    `// swiftlint:disable identifier_name\nlet a = 1\nlet b = 2\n// swiftlint:enable identifier_name\n`,
    "directive"],
  ["Swift：指令没动，别处的注释和空行变了", "lint-stable.swift",
    `// 头\nstruct A {}\n// swiftlint:disable:next type_name\nstruct b {}\n`,
    `// 头（改写）\n\nstruct A {} // 尾\n/* 块 */\n// swiftlint:disable:next type_name\nstruct b {}\n`,
    "comment-only"],
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

test("--loose 只放宽字符串之外的空白：字符串里的空白仍逐字比较", () => {
  const before = 'let s = "a b"\nlet z = a - b\n';
  const spaced = 'let s = "a b"\nlet z = a -b // 空白位置变了\n';
  const inside = 'let s = "a  b"\nlet z = a - b\n';
  assert.equal(status("a.swift", before, spaced, { loose: true }), "comment-only");
  assert.equal(status("a.swift", before, inside, { loose: true }), "code");
  assert.equal(status("a.swift", 'let s = """\n  a\n  b\n  """\n', 'let s = """\n  a\n\n  b\n  """\n', { loose: true }), "code");
});

test("stripSwift：整个字符串（含插值）是一段 string 片段，其余是 code 片段", () => {
  const { code, segments } = stripSwift('let a = "x \\(f(1)) y" // c\nlet b = #"r"#\nlet c = 1\n');
  assert.deepEqual(segments, [
    { kind: "code", text: "let a = " },
    { kind: "string", text: '"x \\(f(1)) y"' },
    { kind: "code", text: " \nlet b = " },
    { kind: "string", text: '#"r"#' },
    { kind: "code", text: "\nlet c = 1\n" },
  ]);
  assert.equal(segments.map((segment) => segment.text).join(""), code);
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
