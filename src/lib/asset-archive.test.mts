import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";

import {
  ASSET_ARCHIVE_PREFIX,
  LEGACY_ASSET_PREFIX,
  STALE_NEXT_COOLDOWN_MS,
  STALE_NEXT_FETCH_TIMEOUT_MS,
  STALE_NEXT_SCRIPT,
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

function runStaleNextScript({ storage, fetchHangs = false, now = 1_000_000 }: { storage: Map<string, string> | null; fetchHangs?: boolean; now?: number }) {
  const timers: Array<() => void> = [];
  let reloads = 0;
  let fetches = 0;
  const sessionStorage = {
    getItem(key: string) {
      if (!storage) throw new Error("blocked");
      return storage.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      if (!storage) throw new Error("blocked");
      storage.set(key, value);
    },
  };
  const context = {
    navigator: { onLine: true },
    Date: { now: () => now },
    sessionStorage,
    location: { href: "https://lyjw.me/", reload: () => reloads++ },
    setTimeout: (fn: () => void) => timers.push(fn),
    clearTimeout: () => {},
    fetch: () => {
      fetches++;
      return fetchHangs ? new Promise(() => {}) : Promise.resolve({ text: () => Promise.resolve("") });
    },
  };
  vm.runInNewContext(STALE_NEXT_SCRIPT, context);
  return { timers, fetches: () => fetches, reloads: () => reloads };
}

test("缺档刷新脚本：重取完刷新一次，冷却期内再执行不刷", async () => {
  const storage = new Map<string, string>();
  const first = runStaleNextScript({ storage });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(first.fetches(), 1);
  assert.equal(first.reloads(), 1);
  first.timers.forEach((fn) => fn());
  assert.equal(first.reloads(), 1);
  const again = runStaleNextScript({ storage, now: 1_000_000 + STALE_NEXT_COOLDOWN_MS - 1 });
  assert.equal(again.fetches(), 0);
  const later = runStaleNextScript({ storage, now: 1_000_000 + STALE_NEXT_COOLDOWN_MS });
  assert.equal(later.fetches(), 1);
});

test("缺档刷新脚本：会话存储不可用时不刷新", () => {
  const run = runStaleNextScript({ storage: null });
  assert.equal(run.fetches(), 0);
  assert.equal(run.timers.length, 0);
});

test(`缺档刷新脚本：重取挂住时 ${STALE_NEXT_FETCH_TIMEOUT_MS}ms 定时器到点照样刷新`, async () => {
  const run = runStaleNextScript({ storage: new Map(), fetchHangs: true });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(run.reloads(), 0);
  run.timers.forEach((fn) => fn());
  assert.equal(run.reloads(), 1);
});
