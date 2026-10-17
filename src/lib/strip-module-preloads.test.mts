import assert from "node:assert/strict";
import { test } from "node:test";

import { deferRouteBoot, stripModulePreloads } from "@/lib/strip-module-preloads";

test("去掉 head 与 body 里的 modulepreload，其余不动", () => {
  const html = `<html><head><link rel="modulepreload" href="/a.js"/></head><body><main>hi</main><link rel="modulepreload" href="/b.js"/></body></html>`;
  assert.equal(stripModulePreloads(html), "<html><head></head><body><main>hi</main></body></html>");
});

test("路由 import 挪到 load 之后执行", () => {
  const html = '<html><head></head><body><script type="module" async="">import("/a.js")</script></body></html>';
  const out = deferRouteBoot(html);
  assert.ok(out.includes('type="text/plain" data-route-boot'));
  assert.ok(out.includes('import("/a.js")'));
  assert.ok(out.includes('window.addEventListener("load"'));
  assert.ok(!out.includes('<script type="module" async="">'));
});

test("没有路由脚本时原样返回", () => {
  const html = "<html><body>hi</body></html>";
  assert.equal(deferRouteBoot(html), html);
});
