import assert from "node:assert/strict";
import test from "node:test";

import { HTML_PREVIEW_MAX_HEIGHT, HTML_PREVIEW_MIN_HEIGHT, htmlPreviewDocument, previewHeight } from "@/lib/html-preview";

test("模型的页面整段进里层 srcdoc 属性，引号和尖括号不能闭合属性逃到外壳", () => {
  const doc = htmlPreviewDocument(`<p title="a">x</p></iframe><script>top.x=1</script>`);
  assert.equal(doc.split("<script").length - 1, 1);
  assert.match(doc, /<iframe sandbox="allow-scripts" srcdoc="[^"<>]*"><\/iframe>/);
});

test("外壳与里层都带断网 CSP，外壳的 frame-src 'none' 拦里层导航", () => {
  const doc = htmlPreviewDocument("<p>x</p>");
  const policies = [...doc.matchAll(/Content-Security-Policy" content="([^"]*)"|Content-Security-Policy&quot; content=&quot;(.*?)&quot;/g)].map((m) => m[1] ?? m[2]);
  assert.equal(policies.length, 2);
  for (const policy of policies) {
    assert.match(policy, /default-src 'none'/);
    assert.match(policy, /frame-src 'none'/);
    assert.doesNotMatch(policy, /https?:|\*/);
  }
});

test("模型自带的 doctype 去掉，CSP 排在模型内容之前", () => {
  const doc = htmlPreviewDocument("<!DOCTYPE html><html><head><title>t</title></head><body>x</body></html>");
  const inner = doc.slice(doc.indexOf("srcdoc="));
  assert.equal(inner.match(/doctype/gi)?.length, 1);
  assert.ok(inner.indexOf("Content-Security-Policy") < inner.indexOf("&lt;title&gt;"));
});

test("上报高度夹在上下限之间，非数字不认", () => {
  assert.equal(previewHeight(10), HTML_PREVIEW_MIN_HEIGHT);
  assert.equal(previewHeight(300.2), 301);
  assert.equal(previewHeight(1e6), HTML_PREVIEW_MAX_HEIGHT);
  assert.equal(previewHeight("300"), null);
  assert.equal(previewHeight(Number.NaN), null);
});
