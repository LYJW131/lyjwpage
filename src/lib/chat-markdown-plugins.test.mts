import assert from "node:assert/strict";
import test from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Markdown from "react-markdown";

import { CHAT_REHYPE_PLUGINS, CHAT_REMARK_PLUGINS, CHAT_STREAM_REHYPE_PLUGINS } from "@/lib/chat-markdown-plugins";

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

test("流式期间中文逐字、英文按词拆成淡入 span，代码块不拆", () => {
  const html = renderToStaticMarkup(createElement(Markdown, { remarkPlugins: CHAT_REMARK_PLUGINS, rehypePlugins: CHAT_STREAM_REHYPE_PLUGINS }, "你好 world **粗体**\n\n```js\nconst a = 1;\n```"));
  assert.match(html, /<span class="stream-token">你<\/span><span class="stream-token">好<\/span> <span class="stream-token">world <\/span><strong><span class="stream-token">粗<\/span>/);
  assert.match(html, /<pre><code class="language-js">const a = 1;\n<\/code><\/pre>/);
});

test("$$…$$ 渲染成 KaTeX，行内与独占一行都行；单个 $ 是价格不当公式", () => {
  const html = (text: string, rehypePlugins = CHAT_REHYPE_PLUGINS) => renderToStaticMarkup(createElement(Markdown, { remarkPlugins: CHAT_REMARK_PLUGINS, rehypePlugins }, text));
  assert.match(html("面积是 $$\\pi r^2$$ 平方米"), /<span class="katex">/);
  assert.match(html("$$\n\\frac{a}{b}\n$$"), /katex-display/);
  assert.equal(html("输入 $10 / 输出 $50 每百万"), "<p>输入 $10 / 输出 $50 每百万</p>");
  const streamed = html("先看 $$x^2$$ 再说", CHAT_STREAM_REHYPE_PLUGINS);
  assert.match(streamed, /<span class="katex">/);
  assert.doesNotMatch(streamed, /class="katex">[^]*stream-token[^]*<\/math>/);
});
