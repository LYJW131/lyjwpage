import assert from "node:assert/strict";
import { test } from "node:test";

import { stripScripts } from "@/lib/strip-scripts";

test("成对的 script 连内容一起删掉，旁边的标记留着", () => {
  assert.equal(stripScripts(`<p>a</p><script type="module">alert(1)</script><p>b</p>`), "<p>a</p><p>b</p>");
});

test("多段 script 与跨行内容一次删干净", () => {
  assert.equal(stripScripts("<script>a</script><div>ok</div><script>\nb()\n</script>"), "<div>ok</div>");
});

test("拆开的 script 去掉内层后还会拼回去，要删到不再出现", () => {
  assert.equal(stripScripts("<scrip<script>is removed</script>t>alert(123)</script>"), "");
  assert.equal(stripScripts("<div><scr<script>a</script>ipt>b</script></div>"), "<div></div>");
});

test("没有 script 时原文不动", () => {
  const html = `<img alt="a < b" src="x">`;
  assert.equal(stripScripts(html), html);
});
