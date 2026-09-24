import { chromium } from "playwright-core";
const [html, shot] = process.argv.slice(2);
const b = await chromium.launch({ channel: "chrome", headless: true });
const errs = [];
for (const [w, h] of [[375, 812], [390, 844]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  p.on("pageerror", (e) => errs.push(e.message));
  await p.goto("file://" + html);
  await p.evaluate(() => window.__ready);
  await p.waitForTimeout(300);
  await p.screenshot({ path: shot.replace(".png", `-${w}-start.png`) });
  const card = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth, pick: document.querySelector("#start .pick").getBoundingClientRect().toJSON(), stage: document.getElementById("stage").getBoundingClientRect().toJSON() }));
  await p.tap('#start button[data-style="piano"]');
  await p.evaluate(() => { document.getElementById("ui").classList.add("show"); document.getElementById("music").pause(); });
  await p.waitForTimeout(500);
  await p.screenshot({ path: shot.replace(".png", `-${w}-ui.png`) });
  const ui = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, ui: document.getElementById("ui").getBoundingClientRect().toJSON(), btns: [...document.querySelectorAll("#ui button")].map((x) => { const r = x.getBoundingClientRect(); return `${x.textContent}:${Math.round(r.width)}x${Math.round(r.height)}`; }).join(" ") }));
  console.log(w, JSON.stringify({ sw: card.sw, iw: card.iw, pickTop: Math.round(card.pick.top), pickBottom: Math.round(card.pick.bottom), stageTop: Math.round(card.stage.top), stageBottom: Math.round(card.stage.bottom) }), "\n   ui:", JSON.stringify(ui));
  await p.close();
}
console.log("errors:", errs.length ? errs : "none");
await b.close();
