import assert from "node:assert/strict";
import { test } from "node:test";

import { ASSET_ARCHIVE_PREFIX, archivedAssetContentType, archivedAssetKey } from "./asset-archive.ts";

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
