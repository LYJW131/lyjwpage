#!/usr/bin/env node
/**
 * 讲解动画的站点版：docs/explainer/v2 的页面源 → public/explainer。
 *
 * 入口 `index.html` 保持原名（`/explainer` 由 next.config 的 rewrite 指到它）；脚本、字体、配乐一律
 * 按内容哈希改名放进 `a/`，地址即版本，next.config 给这个目录一年的 immutable 缓存，
 * ESA 按后缀缓存也不会拿到旧文件。键是页面里写的源相对路径（`music/ch02.js`、`../clawd.js`），
 * 目录并进文件名（`a/music-ch02.<hash>.js`）。页面里的引用：
 * - 脚本按 index.html 的 `LOAD` 表经 `window.__assets`（源相对路径 → 哈希路径）查表，这里读同一张表，
 *   把查表注入到 index.html 头部。还没写的章（`chNN.js`、`music/chNN.js`）缺了不发布、页面也不载入；其余缺了直接失败；
 * - 配乐 `score.mp3` 由 film.js 经同一张表取。缺了直接失败，线上不退回浏览器里现合成；渲法见 docs/explainer/README.md「站点版」；
 * - 内联样式里的相对 `url(…)`（字体在上一级的 `fonts/`）直接替换。
 * 源文件保持原名，本地预览和写章工具都用 docs/explainer/v2 那份。
 *
 * `pnpm build`（scripts/build.mjs）会先跑它；本地 `pnpm dev` 要看 /explainer 时手动跑一次。
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SRC = "docs/explainer/v2";
const OUT = "public/explainer";
const ASSETS = "a";
const SCORE = "score.mp3";
const UNWRITTEN_CHAPTER = /^(music\/)?ch\d\d\.js$/;
const CSS_URL = /url\((["']?)([^"')]+)\1\)/g;
const isFile = (rel) => fs.statSync(path.join(SRC, rel), { throwIfNoEntry: false })?.isFile() ?? false;

const html = fs.readFileSync(path.join(SRC, "index.html"), "utf8");
const loader = /const LOAD = (\[[\s\S]*?\]);/.exec(html);
if (!loader) throw new Error("index.html 里找不到脚本载入表 LOAD");
const scripts = [];
const unwritten = [];
for (const [rel] of JSON.parse(loader[1])) {
  if (isFile(rel)) scripts.push(rel);
  else if (UNWRITTEN_CHAPTER.test(rel)) unwritten.push(rel);
  else throw new Error(`index.html 载入的 ${rel} 不存在`);
}
if (!isFile(SCORE)) throw new Error(`缺 ${SRC}/${SCORE}：站点版只用预渲的整片配乐，先跑 node ${SRC}/tools/score-mp3.mjs`);
const styled = [...html.matchAll(CSS_URL)].map((m) => m[2]).filter((rel) => !/^(?:[a-z]+:|\/|#)/i.test(rel));

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, ASSETS), { recursive: true });

const assets = {};
for (const rel of new Set([...scripts, ...styled, SCORE])) {
  if (!isFile(rel)) throw new Error(`index.html 引用了不存在的 ${rel}`);
  const bytes = fs.readFileSync(path.join(SRC, rel));
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const { name, ext } = path.parse(rel.replace(/^(\.\.\/)+/, "").replaceAll("/", "-"));
  const target = `${ASSETS}/${name}.${hash}${ext}`;
  fs.writeFileSync(path.join(OUT, target), bytes);
  assets[rel] = target;
}

let page = html.replace(CSS_URL, (whole, _quote, rel) => (assets[rel] ? `url(${assets[rel]})` : whole));
// 内联脚本之外还有相对的 src / href，说明页面新加了这里不认识的资源，站点上会 404
const stray = /\s(?:src|href)="(?![a-z]+:|\/|#)([^"]*)"/i.exec(page.replace(/<script>[\s\S]*?<\/script>/g, ""));
if (stray) throw new Error(`index.html 引用的 ${stray[1]} 没有发布到 ${ASSETS}/`);
const charset = '<meta charset="utf-8">\n';
if (!page.includes(charset)) throw new Error("index.html 缺少 charset meta");
// 站点图标（Next 的 /icon 路由）只加在站点版：源页面在 file:// 下取不到它，写章工具会当成报错
const head = `<link rel="icon" href="/icon" type="image/png">\n<script>window.__assets = ${JSON.stringify(assets)};</script>\n`;
page = page.replace(charset, `${charset}${head}`);
fs.writeFileSync(path.join(OUT, "index.html"), page);

console.log(`[explainer] ${Object.keys(assets).length} 个资源按内容哈希写入 ${OUT}/${ASSETS}`);
if (unwritten.length) console.warn(`[explainer] 还没写、不发布（页面上是占位）：${unwritten.join(" ")}`);
