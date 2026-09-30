import { chromium } from "../../render/node_modules/playwright-core/index.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
const page = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../index.html");
const b = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: scale });
const errs = [];
const expectedMissing = (m) => /Failed to load resource|ERR_FILE_NOT_FOUND/.test(m.text()) && /\/(music\/)?ch\d\d\.js$/.test(m.location()?.url || "");
p.on("console", (m) => { if ((m.type() === "error" || m.type() === "warning") && !expectedMissing(m)) errs.push(`${m.type()}: ${m.text()}`); });
p.on("pageerror", (e) => errs.push("pageerror: " + e.message));
await p.goto(`file://${page}?export&lang=${lang}${only ? `&only=${only}` : ""}`);
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
