import assert from "node:assert/strict";
import { test } from "node:test";

import { stripModulePreloads } from "@/lib/strip-module-preloads";

const preloadA = '<link rel="modulepreload" href="/assets/entry.client-A.js"/>';
const preloadB = '<link rel="modulepreload" href="/assets/page-B.js" crossorigin=""/>';

test("去掉 head 与 body 里的 modulepreload，其余不动", () => {
  const html = `<html><head><link rel="stylesheet" href="/assets/root.css"/>${preloadA}<title>x</title></head><body><main>hi</main><script type="module">import("/a.js")</script>${preloadB}</body></html>`;
  assert.equal(
    stripModulePreloads(html),
    `<html><head><link rel="stylesheet" href="/assets/root.css"/><title>x</title></head><body><main>hi</main><script type="module">import("/a.js")</script></body></html>`,
  );
});

test("没有 modulepreload 时原样返回", () => {
  const html = "<html><head></head><body>hi</body></html>";
  assert.equal(stripModulePreloads(html), html);
});
