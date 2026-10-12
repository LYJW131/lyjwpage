import assert from "node:assert/strict";
import test from "node:test";

import { HTML_VISUAL_MAX_HEIGHT, HTML_VISUAL_MIN_HEIGHT, htmlVisualDocument, visualHeight, visualLink, type HtmlVisualTheme } from "@/lib/html-preview";

const THEME: HtmlVisualTheme = { scheme: "dark", vars: { "--fg": "oklch(0.9 0 0)" }, font: "monospace", fontSize: "0.875rem", fontFaces: "" };
const ORIGIN = "https://lyjw.me";

const policies = (doc: string) =>
  [...doc.matchAll(/Content-Security-Policy" content="([^"]*)"|Content-Security-Policy&quot; content=&quot;(.*?)&quot;/g)].map((m) => m[1] ?? m[2]);

test("模型的页面整段进里层 srcdoc 属性，引号和尖括号不能闭合属性逃到外壳", () => {
  const doc = htmlVisualDocument(`<p title="a">x</p></iframe><script>top.x=1</script>`, THEME, ORIGIN);
  assert.equal(doc.split("<script").length - 1, 1);
  assert.match(doc, /<iframe sandbox="allow-scripts" srcdoc="[^"<>]*"><\/iframe>/);
});

test("外壳与里层都带 CSP：不准连网，外壳的 frame-src 'none' 拦里层导航，图片只放行站点与工具数据里的主机", () => {
  const found = policies(htmlVisualDocument("<p>x</p>", THEME, ORIGIN));
  assert.equal(found.length, 2);
  for (const policy of found) {
    assert.match(policy, /default-src 'none'/);
    assert.match(policy, /frame-src 'none'/);
    assert.doesNotMatch(policy, /connect-src|\s\*(\s|;|$)/);
    assert.match(policy, /img-src data: blob: https:\/\/lyjw\.me\/img\/ /);
    assert.match(policy, /font-src data: https:\/\/lyjw\.me\/site-assets\/;/);
  }
});

test("color-scheme 与站点一致，主题变量和模型自带的 doctype 前后顺序正确", () => {
  const doc = htmlVisualDocument("<!DOCTYPE html><html><head><title>t</title></head><body>x</body></html>", THEME, ORIGIN);
  assert.match(doc, /:root\{color-scheme:dark\}/);
  const inner = doc.slice(doc.indexOf("srcdoc="));
  assert.equal(inner.match(/doctype/gi)?.length, 1);
  assert.ok(inner.indexOf("--fg:oklch(0.9 0 0)") < inner.indexOf("&lt;title&gt;"));
});

test("上报高度夹在上下限之间，链接只认 http(s)", () => {
  assert.equal(visualHeight(1), HTML_VISUAL_MIN_HEIGHT);
  assert.equal(visualHeight(300.2), 301);
  assert.equal(visualHeight(1e6), HTML_VISUAL_MAX_HEIGHT);
  assert.equal(visualHeight("300"), null);
  assert.equal(visualLink("https://music.apple.com/x"), "https://music.apple.com/x");
  assert.equal(visualLink("javascript:alert(1)"), null);
  assert.equal(visualLink("data:text/html,x"), null);
});
