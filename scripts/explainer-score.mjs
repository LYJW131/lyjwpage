#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

export const SCORE_SOURCE = "docs/explainer/v2";
// 须与 shared/asset-url.ts#IMAGE_PATH_PREFIX 同步（scripts/explainer-score.test.mjs 核对）
export const SCORE_PATH_PREFIX = "/img";

// v2/index.html 的脚本载入表必须是 JSON 数组；构建脚本和视频键都从这里读
const LOAD_TABLE = /const LOAD = (\[[\s\S]*?\]);/;
export const CSS_URL = /url\((["']?)([^"')]+)\1\)/g;
export const isLocalReference = (rel) => !/^(?:[a-z]+:|\/|#)/i.test(rel);

export function loadTable(html) {
  const loader = LOAD_TABLE.exec(html);
  if (!loader) throw new Error("index.html 里找不到脚本载入表 LOAD");
  return JSON.parse(loader[1]).map(([rel]) => rel);
}

// 整片配乐只由这些文件决定：键按它们的内容算，乐谱改了而时长没变也会换成新对象
export function scoreInputs(root = SCORE_SOURCE) {
  const music = fs
    .readdirSync(path.join(root, "music"))
    .filter((name) => name.endsWith(".js"))
    .sort()
    .map((name) => `music/${name}`);
  return ["../clawd.js", "plan.js", "score.js", ...music, "tools/score-mp3.mjs"];
}

export function scoreObjectKey(root = SCORE_SOURCE) {
  const hash = createHash("sha256");
  for (const rel of scoreInputs(root)) hash.update(rel).update("\0").update(fs.readFileSync(path.join(root, rel))).update("\0");
  return `${hash.digest("hex")}.mp3`;
}

export const scorePublicPath = (root = SCORE_SOURCE) => `${SCORE_PATH_PREFIX}/${scoreObjectKey(root)}`;

// 须与 src/lib/site-policy.ts#IMAGE_OBJECT_PATH 同步（scripts/explainer-score.test.mjs 核对）
export const VIDEO_LANGS = ["zh", "en"];
export const VIDEO_CODECS = ["av1", "hevc"];
// 只管开播前的弹窗、视频播放和边放边合成，导出模式下不碰画布、也不产出 __audio() 的整条混音：改它们不该让已经传上去的视频作废
export const VIDEO_PLAYER_ONLY = new Set(["watch.js", "stream.js"]);
const VIDEO_TOOLS = ["tools/video-release.mjs", "tools/browser.mjs"];

// 成片由页面载入的全部文件、样式里的字体、音效、配乐和出片工具（编码参数写在里面）决定
export function videoInputs(root = SCORE_SOURCE) {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const scripts = loadTable(html).filter((rel) => !VIDEO_PLAYER_ONLY.has(rel));
  const styled = [...html.matchAll(CSS_URL)].map((m) => m[2]).filter(isLocalReference);
  const sfxDir = path.join(root, "sfx");
  const sfx = fs.existsSync(sfxDir) ? fs.readdirSync(sfxDir).filter((f) => f.endsWith(".mp3")).sort().map((f) => `sfx/${f}`) : [];
  return [...new Set(["index.html", ...scripts, ...styled, ...sfx, ...VIDEO_TOOLS])];
}

export function videoHash(root = SCORE_SOURCE) {
  const hash = createHash("sha256").update(scoreObjectKey(root)).update("\0");
  for (const rel of videoInputs(root)) {
    const file = path.join(root, rel);
    // 还没写的章在 LOAD 里却没有文件：记成缺，写出来以后键就变
    const bytes = fs.statSync(file, { throwIfNoEntry: false })?.isFile() ? fs.readFileSync(file) : "\0missing";
    hash.update(rel).update("\0").update(bytes).update("\0");
  }
  return hash.digest("hex");
}

export function videoObjectKey(lang, codec, root = SCORE_SOURCE, hash = videoHash(root)) {
  if (!VIDEO_LANGS.includes(lang) || !VIDEO_CODECS.includes(codec)) throw new Error(`没有这一版视频：${lang} ${codec}`);
  return `${hash}-${lang}.${codec}.mp4`;
}

// 页面经 window.__assets["video/<语种>.<编码>.mp4"] 取视频
export function videoAssets(root = SCORE_SOURCE) {
  const hash = videoHash(root);
  return Object.fromEntries(VIDEO_LANGS.flatMap((lang) => VIDEO_CODECS.map((codec) => [`video/${lang}.${codec}.mp4`, `${SCORE_PATH_PREFIX}/${videoObjectKey(lang, codec, root, hash)}`])));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let video;
  try {
    ({ values: { video } } = parseArgs({ options: { video: { type: "boolean" } }, strict: true }));
  } catch (e) {
    console.error(`${e.message}\n用法：node scripts/explainer-score.mjs [--video]`);
    process.exit(2);
  }
  if (video) for (const [name, url] of Object.entries(videoAssets())) console.log(`${name}\t${url}`);
  else console.log(scoreObjectKey());
}
