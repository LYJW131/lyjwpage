// 用法：node tools/stills.mjs <index.html 绝对路径> <输出目录> <t1> <t2> ...
// 按时刻各截一张 1920×1080 png，文件名带时刻。
import { chromium } from "../../render/node_modules/playwright-core/index.mjs";
import { mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

const [html, out, ...times] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=swiftshader", "--font-render-hinting=none"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.error("页面错误：", e.message));
page.on("console", (m) => m.type() === "error" && console.error("console:", m.text()));
await page.goto(`${pathToFileURL(html).href}?export&t=0`);
await page.waitForFunction(() => window.__ready && window.__ready.then, null, { timeout: 30000 });
await page.evaluate(() => window.__ready);
for (const ts of times) {
  await page.evaluate((t) => window.__seek(t), +ts);
  await page.screenshot({ path: `${out}/t${String(ts).replace(".", "_")}.png` });
}
await browser.close();
