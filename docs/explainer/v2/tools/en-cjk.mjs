import fs from "node:fs";
import { launch, openFilm } from "./browser.mjs";

const HELP = `用法：node docs/explainer/v2/tools/en-cjk.mjs <输出.json> [章号…] [--step 0.125]

章号写 02 或 ch02，可以写几个；不写就查整片。英文版每 --step 小节画一帧，列出画到画布上、含中日文字符的每段字和它头一次出现的位置（章:小节），以及「缺文字」的键。
列出来的字逐条判断：画面里本来就是中文的数据（中文提交说明、中文界面截图）照留，其余是漏翻，到 i18n.js 补英文。`;

const args = process.argv.slice(2);
if (!args.length || args.includes("--help")) {
  console.log(HELP);
  process.exit(args.length ? 0 : 2);
}
const out = args.shift();
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

function hook() {
  const re = /[぀-ヿ㐀-鿿豈-﫿＀-￯　-〿]/;
  window.__cjk = new Map();
  for (const name of ["fillText", "strokeText"]) {
    const orig = CanvasRenderingContext2D.prototype[name];
    CanvasRenderingContext2D.prototype[name] = function (text, ...rest) {
      const s = String(text);
      if (re.test(s) && !window.__cjk.has(s)) window.__cjk.set(s, window.__at ?? "载入");
      return orig.call(this, text, ...rest);
    };
  }
}

const browser = await launch();
const { page, errors, missing, film } = await openFilm(browser, { lang: "en", scale: 0.25, init: hook });
const unknown = want.filter((id) => !film.chapters.some((c) => c.id === id));
if (unknown.length) {
  console.error(`没有这一章：${unknown.join(" ")}`);
  await browser.close();
  process.exit(2);
}
const chapters = want.length ? film.chapters.filter((c) => want.includes(c.id)) : film.chapters;
const cjk = await page.evaluate(({ chapters, BAR, step }) => {
  for (const c of chapters) {
    for (let bar = 0; bar < c.bars; bar += step) {
      window.__at = `${c.id}:${bar.toFixed(3)}`;
      window.__seek(c.t0 + bar * BAR);
    }
  }
  return [...window.__cjk].map(([text, at]) => ({ text, at }));
}, { chapters, BAR: film.BAR, step });
await browser.close();
fs.writeFileSync(out, JSON.stringify({ cjk, missing: [...missing], errors }, null, 1));
console.log(JSON.stringify({ cjk: cjk.length, missing: missing.size, errors: errors.length }));
process.exit(missing.size || errors.length ? 1 : 0);
