import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";

import { dedupeInlineImages } from "@/lib/dedupe-inline-images";

const A = "data:image/webp;base64,UklGRkgAAABXRUJQ+/=";
const B = "data:image/png;base64,iVBORw0KGgo=";
const enqueue = (payload: string) =>
  `<script>window.__reactRouterContext.streamController.enqueue(${JSON.stringify(payload)});</script>`;

function run(html: string, imgs: string[]) {
  const script = /<script>(.*)<\/script>/s.exec(html.slice(html.lastIndexOf("<script>")))?.[1] ?? "";
  const chunks: string[] = [];
  vm.runInNewContext(script, {
    window: { __reactRouterContext: { streamController: { enqueue: (chunk: string) => chunks.push(chunk) } } },
    document: { querySelectorAll: () => imgs.map((src) => ({ getAttribute: () => src })) },
  });
  return chunks;
}

test("loader 数据里与前面 <img> 相同的 data URI 换成按序号读回，解出来的内容不变", () => {
  const payload = JSON.stringify(["hero", A, "row", B, "again", A]);
  const html = `<main><img alt="" src="${B}"/><img class="x" src="${A}"/></main>${enqueue(payload)}`;
  const out = dedupeInlineImages(html);
  assert.ok(!out.slice(out.lastIndexOf("<script>")).includes(A));
  assert.ok(!out.slice(out.lastIndexOf("<script>")).includes(B));
  assert.deepEqual(run(out, [B, A]), [payload]);
});

test("<img> 里没有的 data URI 和别的脚本原样保留", () => {
  const payload = JSON.stringify([A]);
  const html = `<main><img src="/img/x.webp"/></main><script>var a="${A}";</script>${enqueue(payload)}`;
  assert.equal(dedupeInlineImages(html), html);
});

test("找不到对应 <img> 时读回空串，脚本照常入队", () => {
  const payload = JSON.stringify([A]);
  const out = dedupeInlineImages(`<img src="${A}"/>${enqueue(payload)}`);
  assert.deepEqual(run(out, []), [JSON.stringify([""])]);
});
