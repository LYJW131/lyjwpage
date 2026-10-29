import assert from "node:assert/strict";
import { test } from "node:test";
import { clean } from "./clean.js";

test("clean 删到切口拼不回标签，评论尾巴仍切掉，空尖括号留着", () => {
  assert.equal(clean("<scrip<script>t>正文</script>"), "正文");
  assert.equal(clean("<<script>script>正文</script>"), "正文");
  assert.equal(clean("<!<!--x-->-->正文"), "正文");
  assert.equal(clean("Map<string, Array<number>>"), "Map");
  assert.equal(clean("Map<> 留着"), "Map<> 留着");
  assert.equal(clean("<b>正文</b>\n\n\n\n下一段\n<a href=\"https://example.com\">badge</a>"), "正文\n\n下一段");
  assert.equal(clean("正文\n---\n*Was this helpful?* yes"), "正文");
  assert.equal(clean("正文\nUseful? React with an emoji"), "正文");
  assert.equal(clean("x".repeat(1300)).length, 1200);
});
