import assert from "node:assert/strict";
import test from "node:test";

import { stableMarkdown } from "@/lib/streaming-markdown";

test("闭合的 Markdown 原样交出", () => {
  const text = "Hello **world**, see `code` and [link](https://a.b).\n\n- one\n- two";
  assert.equal(stableMarkdown(text), text);
});

test("没收尾的代码块整块压着，收尾后再出现", () => {
  assert.equal(stableMarkdown("Intro\n\n```ts\nconst a = 1;"), "Intro");
  const closed = "Intro\n\n```ts\nconst a = 1;\n```";
  assert.equal(stableMarkdown(closed), closed);
});

test("正在长的表格压着，表格后面有空行才放出", () => {
  assert.equal(stableMarkdown("Look:\n\n| a | b |\n| - | - |\n| 1 |"), "Look:");
  const done = "Look:\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nAfter";
  assert.equal(stableMarkdown(done), done);
});

test("没配对的行内标记从开头处截住", () => {
  assert.equal(stableMarkdown("This is **very imp"), "This is");
  assert.equal(stableMarkdown("Run `npm ins"), "Run");
  assert.equal(stableMarkdown("An *italic wo"), "An");
  assert.equal(stableMarkdown("Read [the docs](https://exa"), "Read");
  assert.equal(stableMarkdown("Read [the do"), "Read");
  assert.equal(stableMarkdown("~~gone"), "");
});

test("列表的星号不算未闭合的强调，尾巴上的半个标记不露出来", () => {
  assert.equal(stableMarkdown("* first\n* second"), "* first\n* second");
  assert.equal(stableMarkdown("Done **"), "Done");
  assert.equal(stableMarkdown("Heading next\n\n#"), "Heading next");
});

test("前面段落里配好的标记不受最后一段影响", () => {
  assert.equal(stableMarkdown("**Bold** para.\n\nNow `half"), "**Bold** para.\n\nNow");
});

test("已经闭合的行内标记在末尾也原样保留", () => {
  for (const text of ["Use `git status`", "This is **done**", "Very *nice*", "I love C#", "Read items[0]", "~~gone~~"]) {
    assert.equal(stableMarkdown(text), text);
  }
});

test("最后一行只有块级起始标记时整行先压着", () => {
  assert.equal(stableMarkdown("List:\n\n- "), "List:");
  assert.equal(stableMarkdown("Quote:\n\n>"), "Quote:");
  assert.equal(stableMarkdown("Steps:\n\n1."), "Steps:");
  assert.equal(stableMarkdown("Code:\n\n``"), "Code:");
  assert.equal(stableMarkdown("- one\n- "), "- one");
});
