import { launch, openFilm } from "./browser.mjs";

const HELP = `用法：node docs/explainer/v2/tools/check.mjs [章号…] [--step 0.125]

中英两版各把要查的章每 --step 小节画一帧，报出字号低于下限的字（要读的标注 28 px、旁白 56 px，见 CONVENTIONS「字号下限」）、
缺文字键和控制台报错，有一条就退出码 1。章号写 02 或 ch02，可以写几个；不写就查全部已写的章。`;

const args = process.argv.slice(2);
if (args.includes("--help")) {
  console.log(HELP);
  process.exit(0);
}
let step = 0.125;
const want = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--step") step = +args[++i];
  else if (/^(ch)?\d\d$/.test(args[i])) want.push(args[i].replace(/^(\d\d)$/, "ch$1"));
  else {
    console.error(`看不懂的参数：${args[i]}\n\n${HELP}`);
    process.exit(2);
  }
}
const b = await launch();
let bad = 0;
for (const lang of ["zh", "en"]) {
  // 字号按逻辑像素量，和画布分辨率无关；画得小一些，云端软件渲染也快。
  const { page: p, errors: errs, missing, film } = await openFilm(b, { lang, check: true, scale: 0.25 });
  const chs = film.chapters, BAR = film.BAR;
  const unknown = want.filter((id) => !chs.some((c) => c.id === id));
  if (unknown.length) {
    console.error(`没有这一章：${unknown.join(" ")}`);
    await b.close();
    process.exit(2);
  }
  const todo = chs.filter((c) => c.placeholder).map((c) => c.id);
  const run = chs.filter((c) => (want.length ? want.includes(c.id) : !c.placeholder));
  for (const c of run) {
    await p.evaluate(({ c, step, BAR }) => {
      for (let bar = 0; bar < c.bars; bar += step) window.__seek(c.t0 + bar * BAR);
    }, { c, step, BAR });
  }
  const C = await p.evaluate(() => window.__CHECK);
  const fold = (list, min) => {
    const m = new Map();
    for (const e of list) { const k = `${e.ch}|${e.str}`; const o = m.get(k); if (!o || e.px > o.px) m.set(k, e); }
    return [...m.values()].filter((e) => e.px < min);
  };
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
  await p.context().close();
}
await b.close();
process.exit(bad ? 1 : 0);
