import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ASSET_ARCHIVE_PREFIX,
  LEGACY_ASSET_PREFIX,
  archivedAssetContentType,
  archivedAssetKey,
  archivedAssetKeys,
  isStaleNextScript,
} from "./asset-archive.ts";

test("构建产物的扁平文件名映射到存档前缀下的同名键", () => {
  assert.equal(archivedAssetKey("/assets/root-C_I5jH7t.css"), `${ASSET_ARCHIVE_PREFIX}root-C_I5jH7t.css`);
  assert.equal(archivedAssetKey("/assets/entry.client-DEFjIM2L.js"), `${ASSET_ARCHIVE_PREFIX}entry.client-DEFjIM2L.js`);
  assert.equal(archivedAssetKey("/assets/GeistMono-Variable-Dispecij.woff2"), `${ASSET_ARCHIVE_PREFIX}GeistMono-Variable-Dispecij.woff2`);
});

test("子目录、穿越、sourcemap、隐藏文件与别的路径不进存档", () => {
  for (const pathname of [
    "/assets/a/b.js",
    "/assets/../img/x.png",
    "/assets/%2e%2e/x.js",
    "/assets/root-abc.js.map",
    "/assets/.env",
    "/assets/",
    "/img/abc.png",
    "/x/assets/root.js",
  ]) {
    assert.equal(archivedAssetKey(pathname), null, pathname);
  }
});

test("按扩展名定 Content-Type，不认识的不给", () => {
  assert.equal(archivedAssetContentType("root-abc.css"), "text/css; charset=utf-8");
  assert.equal(archivedAssetContentType("page-abc.js"), "text/javascript; charset=utf-8");
  assert.equal(archivedAssetContentType("font.woff2"), "font/woff2");
  assert.equal(archivedAssetContentType("page-abc.js.map"), null);
  assert.equal(archivedAssetContentType("notes.txt"), null);
});

test("/assets/ 先找滚动存档，再找长期保留的回填；/_next/static/ 只在回填里", () => {
  assert.deepEqual(archivedAssetKeys("/assets/root-C_I5jH7t.css"), [
    `${ASSET_ARCHIVE_PREFIX}root-C_I5jH7t.css`,
    `${LEGACY_ASSET_PREFIX}assets/root-C_I5jH7t.css`,
  ]);
  assert.deepEqual(archivedAssetKeys("/_next/static/immutable/chunks/2x-sr3yq0__fp.js"), [
    `${LEGACY_ASSET_PREFIX}_next/static/immutable/chunks/2x-sr3yq0__fp.js`,
  ]);
  assert.deepEqual(archivedAssetKeys("/_next/static/immutable/media/GeistMono_Variable.p.0b02cdm7g7y6h.woff2"), [
    `${LEGACY_ASSET_PREFIX}_next/static/immutable/media/GeistMono_Variable.p.0b02cdm7g7y6h.woff2`,
  ]);
});

test("/_next/static/ 的穿越、隐藏文件、sourcemap 与目录不进回填", () => {
  for (const pathname of [
    "/_next/static/../../img/x.png",
    "/_next/static/immutable/../x.js",
    "/_next/static/%2e%2e/x.js",
    "/_next/static/.env",
    "/_next/static/chunks/a.js.map",
    "/_next/static/chunks/",
    "/_next/image",
  ]) {
    assert.deepEqual(archivedAssetKeys(pathname), [], pathname);
  }
});

test("只有 /_next/static/ 下的脚本缺档时换成刷新脚本", () => {
  assert.equal(isStaleNextScript("/_next/static/immutable/chunks/02cb0mgy2t-x7.js"), true);
  assert.equal(isStaleNextScript("/_next/static/chunks/webpack-c7cea1f7fad5b6c7.js"), true);
  assert.equal(isStaleNextScript("/_next/static/immutable/chunks/3ps_id-l_dy58.css"), false);
  assert.equal(isStaleNextScript("/assets/entry.client-DEFjIM2L.js"), false);
});
