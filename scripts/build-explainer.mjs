#!/usr/bin/env node
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
