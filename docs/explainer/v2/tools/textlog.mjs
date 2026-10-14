import fs from "node:fs";
import { launch, openFilm } from "./browser.mjs";

const HELP = `用法：node docs/explainer/v2/tools/textlog.mjs <输出.jsonl> [--lang en] [--every 1] [--from 帧] [--to 帧]

逐帧记下每次 fillText / strokeText 画了什么字、在屏幕上的包围盒（1920×1080 坐标）和透明度，交给 textcheck.py 找叠字、出画、单帧跳变。
第一行是片子信息（帧率、小节长、章节表），之后每行 [帧号, [[字, x0, y0, x1, y1, 透明度], …]]，帧号与 frames.mjs 相同。
只画 2D 图层（WebGL 的上传和绘制换成空函数），比 frames.mjs 快得多；分几段并行时各写各的文件，textcheck.py 能一次读多个。`;

const args = process.argv.slice(2);
if (!args.length || args.includes("--help")) {
  console.log(HELP);
  process.exit(args.length ? 0 : 2);
}
const out = args.shift();
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const FPS = 24;
const lang = opt("--lang", "zh"), every = +opt("--every", 1);

function hook() {
  window.__tl = null;
  const P = CanvasRenderingContext2D.prototype;
  for (const name of ["fillText", "strokeText"]) {
    const orig = P[name];
    P[name] = function (text, x, y, maxW) {
      if (window.__tl && this.globalAlpha > 0.02) {
        const m = this.getTransform(), mt = this.measureText(text);
        const w = maxW !== undefined ? Math.min(mt.width, maxW) : mt.width;
        const al = this.textAlign, f = al === "center" ? 0.5 : al === "right" || al === "end" ? 1 : 0;
        const l = x - w * f, r = l + w, t = y - mt.fontBoundingBoxAscent, b = y + mt.fontBoundingBoxDescent;
        const k = 1920 / this.canvas.width;
        const pts = [[l, t], [r, t], [l, b], [r, b]].map(([u, v]) => [(m.a * u + m.c * v + m.e) * k, (m.b * u + m.d * v + m.f) * k]);
        const xs = pts.map((q) => q[0]), ys = pts.map((q) => q[1]);
        window.__tl.push([String(text), Math.round(Math.min(...xs)), Math.round(Math.min(...ys)), Math.round(Math.max(...xs)), Math.round(Math.max(...ys)), Math.round(this.globalAlpha * 100) / 100]);
      }
      return orig.call(this, text, x, y, maxW);
    };
  }
  for (const proto of [WebGLRenderingContext.prototype, window.WebGL2RenderingContext?.prototype].filter(Boolean)) {
    for (const n of ["texImage2D", "texSubImage2D", "drawArrays", "drawElements"]) proto[n] = function () {};
  }
}

const browser = await launch();
const { page, errors, missing, film } = await openFilm(browser, { lang, init: hook });
const from = +opt("--from", 0), to = Math.min(+opt("--to", Infinity), Math.ceil(film.duration * FPS));
const fd = fs.openSync(out, "w");
fs.writeSync(fd, JSON.stringify({ fps: FPS, lang, BAR: film.BAR, chapters: film.chapters }) + "\n");
const t0 = Date.now();
for (let f = from; f < to; f++) {
  if (f % every) continue;
  const items = await page.evaluate((s) => { window.__tl = []; window.__seek(s); const r = window.__tl; window.__tl = null; return r; }, f / FPS);
  fs.writeSync(fd, JSON.stringify([f, items]) + "\n");
}
fs.closeSync(fd);
await browser.close();
console.log(JSON.stringify({ from, to, secs: Math.round((Date.now() - t0) / 1000), errors: errors.slice(0, 10), missing: [...missing] }));
process.exit(errors.length ? 1 : 0);
