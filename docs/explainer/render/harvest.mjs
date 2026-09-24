// 收集英文模式下还没有译文的中文片段：node harvest.mjs <index.html 绝对路径> <out.json> [步长秒=0.1]
import { chromium } from "playwright-core";
import fs from "node:fs";
const [html, out, stepArg = "0.1"] = process.argv.slice(2);
const b = await chromium.launch({ channel: "chrome", headless: true });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
p.on("pageerror", (e) => console.log("pageerror:", e.message));
await p.goto("file://" + html + "?export&lang=en");
await p.evaluate(() => window.__ready);
const res = await p.evaluate((step) => {
  for (let t = 0; t <= window.__duration; t += step) window.__seek(t);
  const bubbles = Engine.BUBBLES.filter((x) => x.text === x.zh).map((x) => x.zh);
  return { missing: [...window.__missing], bubbles, warn: window.__warn() };
}, +stepArg);
fs.writeFileSync(out, JSON.stringify(res, null, 1));
console.log("missing", res.missing.length, "bubbles untranslated", res.bubbles.length, "warn", res.warn.length);
await b.close();
