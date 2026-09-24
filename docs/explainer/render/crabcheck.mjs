// 章节交界处 Clawd 的位置是否连续：node crabcheck.mjs <html>
import { chromium } from "playwright-core";
const [html] = process.argv.slice(2);
const b = await chromium.launch({ channel: "chrome", headless: true });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
await p.goto("file://" + html + "?export");
await p.evaluate(() => window.__ready);
const r = await p.evaluate(() => Engine.CHAPTERS.filter((c) => c.n > 0).map((c) => {
  const a = Engine.crabPos(c.t0 - 0.01), z = Engine.crabPos(c.t0 + 0.01);
  return `${c.name} @${c.t0.toFixed(1)}: 前 (${a.x.toFixed(0)},${a.y.toFixed(0)}) → 后 (${z.x.toFixed(0)},${z.y.toFixed(0)})${Math.hypot(a.x - z.x, a.y - z.y) > 2 ? "  ✗ 跳位" : ""}`;
}));
console.log(r.join("\n"));
await b.close();
