import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";

import { CHAT_REMARK_PLUGINS } from "@/lib/chat-markdown-plugins";

const render = (text: string) => renderToStaticMarkup(createElement(Markdown, { remarkPlugins: CHAT_REMARK_PLUGINS }, text));

test("闭合 ** 前是全角标点、后接中文时仍是加粗", () => {
  assert.equal(render("- **你想让访客看到或做什么？**比如新增一个展示卡片。"), "<ul>\n<li><strong>你想让访客看到或做什么？</strong>比如新增一个展示卡片。</li>\n</ul>");
  assert.equal(render("**放在哪里？**比如首页"), "<p><strong>放在哪里？</strong>比如首页</p>");
});

test("开头 ** 前是中文、后是全角标点时仍是加粗", () => {
  assert.equal(render("看这里**「重点」**吧"), "<p>看这里<strong>「重点」</strong>吧</p>");
});

test("中文旁的单星号斜体与删除线同样生效", () => {
  assert.equal(render("这是*“强调”*的写法"), "<p>这是<em>“强调”</em>的写法</p>");
  assert.equal(render("价格~~（原价）~~现价"), "<p>价格<del>（原价）</del>现价</p>");
});

test("英文与 GFM 行为不变", () => {
  assert.equal(render("a **b** c, 2*3*4"), "<p>a <strong>b</strong> c, 2<em>3</em>4</p>");
  assert.equal(render("| a |\n| - |\n| 1 |"), "<table><thead><tr><th>a</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>");
});
