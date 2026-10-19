import assert from "node:assert/strict";
import test from "node:test";

import { stripHtmlScripts } from "./strip-html-scripts.ts";

test("大小写、引号、空白和带属性的结束标签里的 script 都删掉", () => {
  const cases = [
    ["<script>foo</script>", ""],
    ["<SCRIPT>foo</SCRIPT>", ""],
    ["<sCrIpT>foo</ScRiPt>", ""],
    ['<script src="foo"></script>', ""],
    ["<script src='foo'></script>", ""],
    ["<script\tsrc='foo'></script>", ""],
    ["<script \n>foo</script>", ""],
    ["<script >foo\n</script>", ""],
    ['<script src="foo">foo</script >', ""],
    ['<script src="foo">foo</script foo="bar">', ""],
    ['<script src="foo">foo</script\t\n bar>', ""],
    ["<b>A</b><SCRIPT>foo</SCRIPT><i>B</i>", "<b>A</b><i>B</i>"],
    ["<span>A &amp; B</span><script>if(a<b){x()}</script><span>C</span>", "<span>A &amp; B</span><span>C</span>"],
  ] as const;
  for (const [html, expected] of cases) assert.equal(stripHtmlScripts(html), expected, html);
});

test("没闭合的 script 一直吞到片段末尾", () => {
  assert.equal(stripHtmlScripts('<script\tsrc="foo"/>'), "");
  assert.equal(stripHtmlScripts("<script/>after"), "");
  assert.equal(stripHtmlScripts("<SCRIPT src=x>alert(1)"), "");
  assert.equal(stripHtmlScripts("<div>before</div><script>alert(1)<div>after</div>"), "<div>before</div>");
});

test("svg、math 和 template 里的 script 也删，周围标记原样留下", () => {
  assert.equal(stripHtmlScripts('<svg><script>alert(1)</script><path d="M0"/></svg>'), '<svg><path d="M0"/></svg>');
  assert.equal(stripHtmlScripts("<svg><SCRIPT>alert(1)</SCRIPT></svg>"), "<svg></svg>");
  assert.equal(stripHtmlScripts("<math><script>alert(1)</script></math>"), "<math></math>");
  assert.equal(stripHtmlScripts("<template><script>alert(1)</script><b>ok</b></template>"), "<template><b>ok</b></template>");
  assert.equal(stripHtmlScripts("<script>a</script>keep<script>b</script>"), "keep");
  assert.equal(
    stripHtmlScripts('<script>const s = "</script>"; alert(1)</script><b>keep</b>'),
    '"; alert(1)</script><b>keep</b>',
  );
});

test("注释、textarea、style、属性和 noscript 里的字面 script 不是元素", () => {
  const keep = [
    "<!-- <script>foo</script> -->",
    "<!-- <script>foo</script --!>",
    "<textarea><script>alert(1)</script></textarea>",
    "<style><script>alert(1)</script></style>",
    '<div title="<script>">x</script></div>',
    "<noscript><script>alert(1)</script></noscript>",
    '<div class="card"><span>Pulse</span><img src="/a.png" width="10" srcSet="/a 1x"></div>',
  ];
  for (const html of keep) assert.equal(stripHtmlScripts(html), html, html);
});
