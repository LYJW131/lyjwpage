// 用法：node tools/artifact.mjs <输出 html>
// 把 index.html 的三段脚本内联成一个文件，字体改从 Google Fonts 取，供发布到 claude.ai Artifact 预览。
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(root, f), "utf8");
const [out] = process.argv.slice(2);
let html = read("index.html");
html = html.replace(/@font-face\{[^}]*\}\n/g, "");
html = html.replace(
  /<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^"]*">/,
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@500;600;700&family=Geist+Mono:wght@400;500;600;700&family=Noto+Sans+SC:wght@500;700&display=swap">',
);
html = html.replace(/<script src="(engine|ch01|film)\.js"><\/script>/g, (_, f) => `<script>\n${read(`${f}.js`)}\n</script>`);
html = html.replace(/^<!doctype html>\n<html lang="zh-CN">\n<head>\n|<\/head>\n<body>\n|<\/body>\n<\/html>\n$/g, "");
html = html.replace("<title>lyjw.me 运行原理 · 拆开来看</title>", "<title>拆开来看</title>").replace("<style>", "<style>\n:root{color-scheme:dark}");
writeFileSync(out, html);
console.log(`写出 ${out}（${(html.length / 1024).toFixed(0)} KB）`);
