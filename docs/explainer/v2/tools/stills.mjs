import fs from "node:fs";
import { launch, openFilm } from "./browser.mjs";

const HELP = `用法：node docs/explainer/v2/tools/stills.mjs <输出目录> <时刻…> [--lang en] [--scale 1] [--only ch03]

在每个时刻截一张整幅画面，存成 <输出目录>/<语种>_<时刻>.png（c05:2.5 存成 zh_c05_2_5.png），最后列出控制台报错和缺文字键。
时刻写秒数（如 95.5），或 c<章号>:<小节>（如 c05:2.5 是第 05 章第 2.5 小节）。
  --scale 截图相对 1920×1080 的倍数，默认 1；0.2 约等于 375 px 宽的手机
  --only  只载入这几章（逗号分隔），别的章不画`;

const args = process.argv.slice(2);
if (!args.length || args.includes("--help")) {
  console.log(HELP);
  process.exit(args.length ? 0 : 2);
}
const out = args.shift();
let lang = "zh", scale = 1, only = "";
const times = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--lang") lang = args[++i];
  else if (args[i] === "--scale") scale = +args[++i];
  else if (args[i] === "--only") only = args[++i];
  else if (/^(c\d\d:)?[\d.]+$/.test(args[i])) times.push(args[i]);
  else {
    console.error(`看不懂的参数：${args[i]}\n\n${HELP}`);
    process.exit(2);
  }
}
if (out.startsWith("-") || !times.length) {
  console.error(HELP);
  process.exit(2);
}
fs.mkdirSync(out, { recursive: true });
const b = await launch();
const { page: p, errors: errs, missing, film } = await openFilm(b, { lang, scale, only });
const chs = film.chapters, BAR = film.BAR;
for (const t of times) {
  let sec = +t;
  const m = /^c(\d\d):([\d.]+)$/.exec(t);
  if (m) {
    const c = chs.find((c) => c.id === "ch" + m[1]);
    if (!c) {
      errs.push(`没有这一章：ch${m[1]}（时刻 ${t} 没截）`);
      continue;
    }
    sec = c.t0 + +m[2] * BAR;
  }
  await p.evaluate((s) => window.__seek(s), sec);
  await p.screenshot({ path: `${out}/${lang}_${t.replace(/[:.]/g, "_")}.png` });
}
for (const k of missing) errs.push(`缺文字：${k}`);
if (errs.length) console.log(errs.slice(0, 20).join("\n"));
await b.close();
console.log("done", times.length);
