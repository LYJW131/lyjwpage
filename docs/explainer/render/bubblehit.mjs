// 气泡压到画面元素：每句气泡中段，量气泡和可见卡片 / 标签 / 窗口的重叠面积；只列英文比中文多出来的。
// node bubblehit.mjs <index.html 绝对路径>
import { chromium } from "playwright-core";
const [html] = process.argv.slice(2);
const b = await chromium.launch({ channel: "chrome", headless: true });
async function hits(lang) {
  const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
  await p.goto(`file://${html}?export&lang=${lang}`);
  await p.evaluate(() => window.__ready);
  const r = await p.evaluate(() => {
    const vis = (el) => { for (let e = el; e && e.id !== "stage"; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.visibility === "hidden" || +cs.opacity < 0.3 || cs.display === "none") return false; } return true; };
    const bub = document.getElementById("bOuter");
    return Engine.BUBBLES.map((x) => {
      const t = Math.min(x.b - 0.3, x.te + 0.6);
      window.__seek(t);
      const br = bub.getBoundingClientRect();
      const hit = [];
      for (const el of document.querySelectorAll("#stage .card, #stage .win, #stage .term, #stage .tg, #stage .pkt, #stage .end-t, #stage .end-s")) {
        if (!vis(el) || bub.contains(el)) continue;
        const r = el.getBoundingClientRect();
        const w = Math.min(r.right, br.right) - Math.max(r.left, br.left), h = Math.min(r.bottom, br.bottom) - Math.max(r.top, br.top);
        if (w > 6 && h > 6) hit.push(((el.querySelector(".hd") || el).textContent || "").trim().slice(0, 30) + ` (${Math.round(w)}×${Math.round(h)})`);
      }
      return { t: +t.toFixed(1), hit };
    });
  });
  await p.close();
  return r;
}
const zh = await hits("zh"), en = await hits("en");
en.forEach((e, i) => { const z = new Set(zh[i].hit.map((s) => s.replace(/ \(.*/, ""))); const extra = e.hit.filter((s) => !z.has(s.replace(/ \(.*/, ""))); if (extra.length) console.log(`${e.t}s`, extra.join(" | ")); });
console.log("done");
await b.close();
