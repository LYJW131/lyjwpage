#!/usr/bin/env node
/**
 * 讲解动画的站点版：docs/explainer 的页面源 → public/explainer。
 *
 * 入口 `index.html` 保持原名（`/explainer` 由 next.config 的 rewrite 指到它）；脚本、字体、配乐一律
 * 按内容哈希改名放进 `a/`，地址即版本，next.config 给这个目录一年的 immutable 缓存，
 * ESA 按后缀缓存也不会拿到旧文件。页面里的引用：
 * - 脚本和配乐经 `window.__assets`（原名 → 哈希路径）查表，这里把表注入到 index.html 头部；
 * - 字体写在内联样式的 `url(fonts/…)` 里，直接替换。
 * 源文件保持原名，本地预览、渲染工具和 Artifact 发布都用 docs/explainer 那份。
 *
 * `pnpm build`（scripts/build.mjs）会先跑它；本地 `pnpm dev` 要看 /explainer 时手动跑一次。
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const SRC = "docs/explainer";
const OUT = "public/explainer";
const ASSETS = "a";

const html = fs.readFileSync(path.join(SRC, "index.html"), "utf8");
const loader = /for \(const f of (\[[^\]]+\])\)/.exec(html);
if (!loader) throw new Error("index.html 里找不到脚本载入表");
const scripts = JSON.parse(loader[1]).map((name) => `${name}.js`);
const fonts = fs.readdirSync(path.join(SRC, "fonts")).filter((f) => f.endsWith(".woff2")).map((f) => `fonts/${f}`);
const music = fs.readdirSync(SRC).filter((f) => /^music-[a-z]+\.mp3$/.test(f));
if (music.length === 0) throw new Error(`${SRC} 里没有配乐 mp3`);

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, ASSETS), { recursive: true });

const assets = {};
for (const rel of [...scripts, ...fonts, ...music]) {
  const bytes = fs.readFileSync(path.join(SRC, rel));
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const { name, ext } = path.parse(rel);
  const target = `${ASSETS}/${name}.${hash}${ext}`;
  fs.writeFileSync(path.join(OUT, target), bytes);
  assets[rel] = target;
}

let page = html.replace(/url\((fonts\/[^)]+)\)/g, (_, rel) => {
  if (!assets[rel]) throw new Error(`index.html 引用了不存在的字体 ${rel}`);
  return `url(${assets[rel]})`;
});
const charset = '<meta charset="utf-8">\n';
if (!page.includes(charset)) throw new Error("index.html 缺少 charset meta");
page = page.replace(charset, `${charset}<script>window.__assets = ${JSON.stringify(assets)};</script>\n`);
fs.writeFileSync(path.join(OUT, "index.html"), page);

console.log(`[explainer] ${Object.keys(assets).length} 个资源按内容哈希写入 ${OUT}/${ASSETS}`);
