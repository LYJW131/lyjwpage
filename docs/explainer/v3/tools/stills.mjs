// 用法：node tools/stills.mjs <index.html 绝对路径或 http 地址（ES module 必须走 http）> <输出目录> <t1> <t2> ...
// 按时刻各截一张 1920×1080 png，文件名带时刻。
import { chromium } from "../../render/node_modules/playwright-core/index.mjs";
import { mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

const [html, out, ...times] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--font-render-hinting=none"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.error("页面错误：", e.message));
page.on("console", (m) => ["error", "warning"].includes(m.type()) && console.error("console:", m.text()));
page.on("requestfailed", (r) => console.error("加载失败：", r.url(), r.failure()?.errorText));
await page.goto(`${/^https?:/.test(html) ? html : pathToFileURL(html).href}?export&t=0`);
await page.waitForFunction(() => window.__ready && window.__ready.then, null, { timeout: 60000 });
await page.evaluate(() => window.__ready);
for (const ts of times) {
  await page.evaluate((t) => window.__seek(t), +ts);
  await page.screenshot({ path: `${out}/t${String(ts).replace(".", "_")}.png` });
}
await browser.close();
