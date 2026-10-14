import fs from "node:fs";
import { launch, openFilm } from "./browser.mjs";
const args = process.argv.slice(2);
const out = args.shift();
let lang = "zh", scale = 1, only = "";
const times = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--lang") lang = args[++i];
  else if (args[i] === "--scale") scale = +args[++i];
  else if (args[i] === "--only") only = args[++i];
  else times.push(args[i]);
}
fs.mkdirSync(out, { recursive: true });
const b = await launch();
const { page: p, errors: errs, missing, film } = await openFilm(b, { lang, scale, only });
const chs = film.chapters, BAR = film.BAR;
for (const t of times) {
  let sec = +t;
  const m = /^c(\d+):([\d.]+)$/.exec(t);
  if (m) { const c = chs.find((c) => c.id === "ch" + m[1]); sec = c.t0 + +m[2] * BAR; }
  await p.evaluate((s) => window.__seek(s), sec);
  await p.screenshot({ path: `${out}/${lang}_${t.replace(/[:.]/g, "_")}.png` });
}
for (const k of missing) errs.push(`缺文字：${k}`);
if (errs.length) console.log(errs.slice(0, 20).join("\n"));
await b.close();
console.log("done", times.length);
