#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { findUnpublishedReference } from "./explainer-html.mjs";
import { CSS_URL, isLocalReference, loadTable, scorePublicPath, videoAssets } from "./explainer-score.mjs";

const SRC = "docs/explainer/v2";
const OUT = "public/explainer";
const ASSETS = "a";
const UNWRITTEN_CHAPTER = /^(music\/)?ch\d\d\.js$/;
const isFile = (rel) => fs.statSync(path.join(SRC, rel), { throwIfNoEntry: false })?.isFile() ?? false;

const html = fs.readFileSync(path.join(SRC, "index.html"), "utf8");
const scripts = [];
const unwritten = [];
for (const rel of loadTable(html)) {
  if (isFile(rel)) scripts.push(rel);
  else if (UNWRITTEN_CHAPTER.test(rel)) unwritten.push(rel);
  else throw new Error(`index.html 载入的 ${rel} 不存在`);
}
const styled = [...html.matchAll(CSS_URL)].map((m) => m[2]).filter(isLocalReference);

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, ASSETS), { recursive: true });

const assets = {};
// film.js 按 sfx/<名字>.mp3 经 window.__assets 取音效
const sfx = (fs.existsSync(path.join(SRC, "sfx")) ? fs.readdirSync(path.join(SRC, "sfx")) : []).filter((f) => f.endsWith(".mp3")).map((f) => `sfx/${f}`);
for (const rel of new Set([...scripts, ...styled, ...sfx])) {
  if (!isFile(rel)) throw new Error(`index.html 引用了不存在的 ${rel}`);
  const bytes = fs.readFileSync(path.join(SRC, rel));
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const { name, ext } = path.parse(rel.replace(/^(\.\.\/)+/, "").replaceAll("/", "-"));
  const target = `${ASSETS}/${name}.${hash}${ext}`;
  fs.writeFileSync(path.join(OUT, target), bytes);
  assets[rel] = target;
}

// 配乐不进仓库：由 .github/workflows/explainer-score.yml 渲好按乐谱哈希传到 R2；对象还没传上时 film.js 取不到，退回现合成
assets["score.mp3"] = scorePublicPath(SRC);
// 成片视频由 lyjw 在 Mac 上用 v2/tools/video-release.mjs 渲好按源码哈希传到 R2；还没传上时 watch.js 的 HEAD 不是 200，弹窗里视频项置灰
Object.assign(assets, videoAssets(SRC));

let page = html.replace(CSS_URL, (whole, _quote, rel) => (assets[rel] ? `url(${assets[rel]})` : whole));
const stray = findUnpublishedReference(page);
if (stray !== null) throw new Error(`index.html 引用的 ${stray} 没有发布到 ${ASSETS}/`);
const charset = '<meta charset="utf-8">\n';
if (!page.includes(charset)) throw new Error("index.html 缺少 charset meta");
// 站点图标（/icon）只加在站点版：源页面在 file:// 下取不到它，写章工具会当成报错
const head = `<link rel="icon" href="/icon" type="image/png">\n<script>window.__assets = ${JSON.stringify(assets)};</script>\n`;
page = page.replace(charset, `${charset}${head}`);
fs.writeFileSync(path.join(OUT, "index.html"), page);

const hashed = Object.values(assets).filter((target) => target.startsWith(`${ASSETS}/`)).length;
console.log(`[explainer] ${hashed} 个资源按内容哈希写入 ${OUT}/${ASSETS}，配乐取 ${assets["score.mp3"]}，视频取 ${assets["video/zh.av1.mp4"].replace(/-zh\.av1\.mp4$/, "-*.mp4")}`);
if (unwritten.length) console.warn(`[explainer] 还没写、不发布（页面上是占位）：${unwritten.join(" ")}`);
