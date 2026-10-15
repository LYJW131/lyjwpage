import assert from "node:assert/strict";
import { test } from "node:test";

import { deferModulePreloads } from "@/lib/defer-module-preloads";

const preloadA = '<link rel="modulepreload" href="/assets/entry.client-A.js"/>';
const preloadB = '<link rel="modulepreload" href="/assets/page-B.js" crossorigin=""/>';

test("head 里的 modulepreload 按原顺序挪到 </body> 前，其余不动", () => {
  const html = `<html><head><link rel="stylesheet" href="/assets/root.css"/>${preloadA}<title>x</title>${preloadB}</head><body><main>hi</main><script type="module">import("/a.js")</script></body></html>`;
  assert.equal(
    deferModulePreloads(html),
    `<html><head><link rel="stylesheet" href="/assets/root.css"/><title>x</title></head><body><main>hi</main><script type="module">import("/a.js")</script>${preloadA}${preloadB}</body></html>`,
  );
});

test("body 里本来就有的 modulepreload 留在原处", () => {
  const html = `<html><head></head><body>${preloadA}</body></html>`;
  assert.equal(deferModulePreloads(html), html);
});

test("缺 </head> 或 </body> 时原样返回", () => {
  assert.equal(deferModulePreloads(`<head>${preloadA}`), `<head>${preloadA}`);
  assert.equal(deferModulePreloads(`<head>${preloadA}</head>`), `<head>${preloadA}</head>`);
});
