import assert from "node:assert/strict";
import test from "node:test";

import { STREAM_DRAIN_MS, STREAM_FLUSH_MS, revealedLength, revealedText, stableMarkdown } from "@/lib/streaming-markdown";

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

test("没收尾的图示代码块带着已写出的部分补上收尾，还没正文时是空块", () => {
  assert.equal(stableMarkdown("Demo:\n\n```html\n<p>hi</p>\n<di"), "Demo:\n\n```html\n<p>hi</p>\n<di\n```");
  assert.equal(stableMarkdown("Demo:\n\n```timeline\n"), "Demo:\n\n```timeline\n```");
  assert.equal(stableMarkdown("Demo:\n\n```stats\n{\"items\":[]}\n``"), "Demo:\n\n```stats\n{\"items\":[]}\n```");
  assert.equal(stableMarkdown('Demo:\n\n```chart\n{"type":"ba'), 'Demo:\n\n```chart\n{"type":"ba\n```');
  assert.equal(stableMarkdown("Demo:\n\n```ht"), "Demo:");
  assert.equal(stableMarkdown("Demo:\n\n```HTML\n<p>hi"), "Demo:\n\n```HTML\n<p>hi\n```");
  assert.equal(stableMarkdown("Demo:\n\n```json\n{"), "Demo:");
});

test("成块到达的文字约在 STREAM_DRAIN_MS 内匀速放完，流结束后更快收尾", () => {
  const text = "字".repeat(300);
  const steps = (finished: boolean) => {
    let shown = 0;
    let ms = 0;
    while (shown < text.length) {
      shown = revealedLength(text, shown, 16, finished);
      ms += 16;
    }
    return ms;
  };
  const streaming = steps(false);
  const flushing = steps(true);
  assert.ok(revealedLength(text, 0, 16, false) < 20, "第一帧只放一小段");
  assert.ok(streaming > STREAM_DRAIN_MS / 2 && streaming < STREAM_DRAIN_MS * 4, `${streaming}ms`);
  assert.ok(flushing < streaming && flushing < STREAM_FLUSH_MS * 4, `${flushing}ms`);
});

test("放字不切在代理对中间", () => {
  assert.equal(revealedText("a😀b", 2), "a😀");
  assert.equal(revealedText("a😀b", 1), "a");
});

test("没收尾的 $$ 公式先压着，收尾后整条出现", () => {
  assert.equal(stableMarkdown("面积是 $$\\pi r"), "面积是");
  assert.equal(stableMarkdown("面积是 $$\\pi r^2$$ 平方米"), "面积是 $$\\pi r^2$$ 平方米");
});
