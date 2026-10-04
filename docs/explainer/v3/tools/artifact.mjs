// 用法：node tools/artifact.mjs <输出 html>
// 内联成一个文件：Three.js 改从 jsDelivr 取（importmap），三段模块脚本合成一段，字体改从 Google Fonts 取，供发布到 claude.ai Artifact。
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(root, f), "utf8");
const [out] = process.argv.slice(2);
const THREE_VERSION = "0.160.0";
let html = read("index.html");
html = html.replace(/@font-face\{[^}]*\}\n/g, "");
html = html.replace(
  /<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^"]*">/,
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@500;600;700&family=Geist+Mono:wght@400;500;600;700&family=Noto+Sans+SC:wght@500;700&display=swap">',
);
html = html.replace(
  /<script type="importmap">[\s\S]*?<\/script>/,
  `<script type="importmap">{"imports":{"three":"https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/build/three.module.min.js","three/addons/":"https://cdn.jsdelivr.net/npm/three@${THREE_VERSION}/examples/jsm/"}}</script>`,
);
const strip = (f) => read(f).replace(/^import \{ S \} from "\.\/scene\.js";\n/m, "");
const scene = read("scene.js").replace("export const S =", "const S =");
html = html.replace(
  /<script src="engine\.js"><\/script>\n<script type="module" src="ch01\.js"><\/script>\n<script type="module" src="film\.js"><\/script>/,
  `<script>\n${read("engine.js")}\n</script>\n<script type="module">\n${scene}\n${strip("ch01.js")}\n${strip("film.js")}\n</script>`,
);
html = html.replace(/^<!doctype html>\n<html lang="zh-CN">\n<head>\n|<\/head>\n<body>\n|<\/body>\n<\/html>\n$/g, "");
html = html.replace("<title>lyjw.me 运行原理 · 拆开来看</title>", "<title>拆开来看</title>").replace("<style>", "<style>\n:root{color-scheme:dark}");
writeFileSync(out, html);
console.log(`写出 ${out}（${(html.length / 1024).toFixed(0)} KB）`);
