import assert from "node:assert/strict";
import test from "node:test";

import ts from "typescript";

import { compareContents, stripSwift } from "./comment-only-check.ts";

const status = (file: string, before: string | null, after: string | null, options: { loose?: boolean } = {}) => compareContents({ ts, file, before, after, ...options }).status;

const CASES = [
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

test("Swift 正则字面量里含 // 或 /*：不给仅注释结论，两边任一边出现都报解析失败", () => {
  const payloads: [string, string][] = [
    ["let re = #/a//b/#; let x = 1\n", "let re = #/a//b/#; let x = 2\n"],
    ["let re = #/[/*]/#\nlet x = 1\nlet y = 2\n", "let re = #/[/*]/#\nlet x = 9\nlet y = 8\n"],
    ["let re = ##/a//b/##; let x = 1\n", "let re = ##/a//b/##; let x = 2\n"],
    ["let re = #/a//b/#\nlet x = 1\n", "let re = #/a//b/# // 注释\nlet x = 1\n"],
  ];
  for (const [before, after] of payloads) {
    assert.equal(status("a.swift", before, after), "parse-error", after);
    assert.equal(status("a.swift", after, before), "parse-error", before);
  }
  assert.equal(status("a.swift", "let x = 1\n", "let re = #/a//b/#\nlet x = 1\n"), "parse-error");
  assert.equal(status("a.swift", "let re = #/a//b/#\n", "let re = #/a//b/#\n"), "unchanged");
  assert.ok(stripSwift("let re = #/a//b/#\n").errors.length > 0);
});

test("Swift 正则字面量：不含注释分隔符的照常比较，转义与井号个数按字面量读完", () => {
  assert.equal(status("a.swift", "let re = #/a\\d+/#\nlet x = 1\n", "// 说明\nlet re = #/a\\d+/# // 尾\nlet x = 1\n"), "comment-only");
  assert.equal(status("a.swift", "let re = #/a\\d+/#\nlet x = 1\n", "let re = #/a\\d+/#\nlet x = 2\n"), "code");
  assert.equal(status("a.swift", "let re = #/a\\d+/#\n", "let re = #/a\\w+/#\n"), "code");
  const { code, comments, errors } = stripSwift("let re = ##/a/#b\\/c/##; let x = 1 // 尾\n");
  assert.deepEqual(errors, []);
  assert.deepEqual(comments, ["// 尾"]);
  assert.ok(code.includes("##/a/#b\\/c/##; let x = 1"));
  assert.deepEqual(stripSwift("let a = #\"x//y\"#\n").errors, []);
});

test("Swift 正则字面量没写完：不给结论", () => {
  assert.equal(status("a.swift", "let re = #/abc\nlet x = 1\n", "let re = #/abc\nlet x = 2\n"), "parse-error");
});
