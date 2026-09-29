// 抽帧：node stills.mjs <输出目录> [--lang en] [--scale 1] t1 t2 ...   时间写秒，或写 c02:5.5（第 02 章第 5.5 小节）
import { chromium } from "../../render/node_modules/playwright-core/index.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const args = process.argv.slice(2);
const out = args.shift();
let lang = "zh", scale = 1;
const times = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--lang") lang = args[++i];
  else if (args[i] === "--scale") scale = +args[++i];
  else times.push(args[i]);
}
fs.mkdirSync(out, { recursive: true });
const page = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../index.html");
const b = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: scale });
const errs = [];
p.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errs.push(`${m.type()}: ${m.text()}`); });
p.on("pageerror", (e) => errs.push("pageerror: " + e.message));
await p.goto(`file://${page}?export&lang=${lang}`);
await p.evaluate(() => window.__ready);
const chs = await p.evaluate(() => window.__chapters);
const BAR = await p.evaluate(() => window.__BAR);
for (const t of times) {
  let sec = +t;
  const m = /^c(\d+):([\d.]+)$/.exec(t);
  if (m) { const c = chs.find((c) => c.id === "ch" + m[1]); sec = c.t0 + +m[2] * BAR; }
  await p.evaluate((s) => window.__seek(s), sec);
  await p.screenshot({ path: `${out}/${lang}_${t.replace(/[:.]/g, "_")}.png` });
}
if (errs.length) console.log(errs.slice(0, 20).join("\n"));
await b.close();
console.log("done", times.length);
