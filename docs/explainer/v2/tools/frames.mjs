import fs from "node:fs";
import { launch, openFilm } from "./browser.mjs";

const HELP = `用法：node docs/explainer/v2/tools/frames.mjs <输出目录> [--lang en] [--every 4] [--from 帧] [--to 帧] [--scale 0.5]

把整片按 24 帧每秒逐帧渲成 JPEG，文件名是 24 fps 的帧号（00000.jpg 起），中英两版、多次渲染的同一帧同名，可以逐字节比对。
  --every k   只渲帧号能被 k 整除的帧（英文版用 4，即每秒 6 帧）
  --from/--to 帧号范围，左闭右开；默认整片
  --scale     输出相对 1920×1080 的倍数，默认 0.5（960×540）
目录里已有的帧跳过，所以中断后重跑接着渲；分几段并行时各给一段 --from/--to。
另写 film.json（帧率、小节长、章节表），sheets.py、flicker.py 按它标章节与小节。`;

const args = process.argv.slice(2);
if (!args.length || args.includes("--help")) {
  console.log(HELP);
  process.exit(args.length ? 0 : 2);
}
const out = args.shift();
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const FPS = 24;
const lang = opt("--lang", "zh"), every = +opt("--every", 1), scale = +opt("--scale", 0.5);

fs.mkdirSync(out, { recursive: true });
const browser = await launch();
const { page, errors, film } = await openFilm(browser, { lang, scale });
fs.writeFileSync(`${out}/film.json`, JSON.stringify({ fps: FPS, lang, duration: film.duration, BAR: film.BAR, chapters: film.chapters }, null, 1));
const from = +opt("--from", 0), to = Math.min(+opt("--to", Infinity), Math.ceil(film.duration * FPS));
const t0 = Date.now();
let rendered = 0;
for (let f = from; f < to; f++) {
  if (f % every) continue;
  const name = `${out}/${String(f).padStart(5, "0")}.jpg`;
  if (fs.existsSync(name)) continue;
  // 页面载入后画的头一帧会和之后再画同一时刻差几个色阶，跨次渲染就没法逐字节比对；头一帧先空画一次。
  if (!rendered) await page.evaluate((s) => window.__seek(s), f / FPS);
  await page.evaluate((s) => window.__seek(s), f / FPS);
  await page.screenshot({ path: name, type: "jpeg", quality: 82 });
  rendered++;
}
await browser.close();
console.log(JSON.stringify({ from, to, rendered, secs: Math.round((Date.now() - t0) / 1000), errors: errors.slice(0, 10) }));
process.exit(errors.length ? 1 : 0);
