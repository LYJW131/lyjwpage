import { chromium } from "playwright-core";
const [html, shot] = process.argv.slice(2);
const b = await chromium.launch({ channel: "chrome", headless: true });
for (const [w, h] of [[1280, 760], [1440, 900]]) {
  const p = await b.newPage({ viewport: { width: w, height: h } });
  await p.goto("file://" + html);
  await p.evaluate(() => window.__ready);
  await p.waitForTimeout(300);
  await p.screenshot({ path: shot.replace(".png", `-${w}.png`) });
  console.log(w, JSON.stringify(await p.evaluate(() => ({ last: document.querySelectorAll("#start button.last").length, pick: document.querySelector("#start .pick").getBoundingClientRect().top | 0 }))));
  await p.close();
}
await b.close();
