import { chromium } from "../../render/node_modules/playwright-core/index.mjs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const args = process.argv.slice(2);
let step = 0.125;
const want = [];
for (let i = 0; i < args.length; i++) { if (args[i] === "--step") step = +args[++i]; else want.push(args[i].replace(/^(\d\d)$/, "ch$1")); }
const page = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../index.html");
const expectedMissing = (m) => /Failed to load resource|ERR_FILE_NOT_FOUND/.test(m.text()) && /\/(music\/)?ch\d\d\.js$/.test(m.location()?.url || "");
const b = await chromium.launch({ channel: "chrome", headless: true, args: ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] });
let bad = 0;
for (const lang of ["zh", "en"]) {
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 0.5 });
  const errs = [], missing = new Set();
  p.on("console", (m) => {
    if (expectedMissing(m)) return;
    if (m.type() === "warning" && m.text().startsWith("缺文字")) missing.add(m.text().replace(/^缺文字：\s*/, ""));
    else if (m.type() === "error") errs.push(m.text());
  });
  p.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  await p.goto(`file://${page}?export&check&lang=${lang}`);
  await p.evaluate(() => window.__ready);
  const chs = await p.evaluate(() => window.__chapters);
  const todo = chs.filter((c) => c.placeholder).map((c) => c.id);
  const run = chs.filter((c) => (want.length ? want.includes(c.id) : !c.placeholder));
  for (const c of run) {
    await p.evaluate(({ c, step, BAR }) => {
      for (let bar = 0; bar < c.bars; bar += step) window.__seek(c.t0 + bar * BAR);
    }, { c, step, BAR: await p.evaluate(() => window.__BAR) });
  }
  const C = await p.evaluate(() => window.__CHECK);
  const fold = (list, min) => {
    const m = new Map();
    for (const e of list) { const k = `${e.ch}|${e.str}`; const o = m.get(k); if (!o || e.px > o.px) m.set(k, e); }
    return [...m.values()].filter((e) => e.px < min);
  };
  const BAR = await p.evaluate(() => window.__BAR);
  const where = (e) => { const c = chs.find((c) => c.id === e.ch); return `${e.ch}:${((e.t - c.t0) / BAR).toFixed(2)}`; };
  const small = fold(C.all.filter((e) => !e.narr), 27.5), narr = fold(C.all.filter((e) => e.narr), 55.5);
  console.log(`\n== ${lang} · 查了 ${run.map((c) => c.id).join(" ") || "（没有已写的章）"} · 每 ${step} 小节一帧`);
  if (todo.length) console.log(`占位（还没写）：${todo.join(" ")}`);
  for (const e of small) console.log(`  字太小  ${where(e)}  ${e.px}px  「${e.str}」`);
  for (const e of narr) console.log(`  旁白太小  ${where(e)}  ${e.px}px  「${e.str}」`);
  for (const k of missing) console.log(`  缺文字键  ${k}`);
  for (const e of errs) console.log(`  报错  ${e}`);
  const n = small.length + narr.length + missing.size + errs.length;
  if (!n) console.log("  没有问题");
  bad += n;
  await p.close();
}
await b.close();
process.exit(bad ? 1 : 0);
