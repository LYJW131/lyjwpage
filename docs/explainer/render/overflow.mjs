// 文字溢出自检：卡片里的文字超出卡片边框、底部章节标签互相压住。node overflow.mjs <index.html 绝对路径> <zh|en> [步长=0.5]
import { chromium } from "playwright-core";
const [html, lang = "en", stepArg = "0.5"] = process.argv.slice(2);
const b = await chromium.launch({ channel: "chrome", headless: true });
const p = await b.newPage({ viewport: { width: 1920, height: 1080 } });
await p.goto(`file://${html}?export&lang=${lang}`);
await p.evaluate(() => window.__ready);
const res = await p.evaluate((step) => {
  const out = new Map();
  const vis = (el) => { for (let e = el; e && e !== document.body; e = e.parentElement) { const cs = getComputedStyle(e); if (cs.visibility === "hidden" || +cs.opacity < 0.05 || cs.display === "none") return false; } return true; };
  const label = (el) => (el.querySelector(".hd") || el).textContent.trim().slice(0, 40);
  for (let t = 0; t <= window.__duration; t += step) {
    window.__seek(t);
    for (const c of document.querySelectorAll("#stage .card, #stage .tg, #stage .pkt")) {
      if (!vis(c)) continue;
      const r = c.getBoundingClientRect(); if (r.width < 4) continue;
      let over = 0;
      const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        if (!n.data.trim()) continue;
        const rg = document.createRange(); rg.selectNodeContents(n);
        for (const q of rg.getClientRects()) over = Math.max(over, q.right - r.right, r.left - q.left);
      }
      if (over > 2) { const k = label(c); const v = out.get(k); if (!v || v.over < over) out.set(k, { t: +t.toFixed(1), over: Math.round(over) }); }
    }
  }
  const labs = [...document.querySelectorAll(".plab")].map((e) => ({ t: e.textContent, r: e.getBoundingClientRect() }));
  const clash = [];
  for (let i = 1; i < labs.length; i++) if (labs[i].r.left < labs[i - 1].r.right + 4) clash.push(`${labs[i - 1].t} | ${labs[i].t}`);
  return { over: [...out.entries()], clash };
}, +stepArg);
for (const [k, v] of res.over) console.log(`${v.t}s +${v.over}px  ${k}`);
console.log("label clashes:", res.clash.length ? res.clash : "none");
await b.close();
