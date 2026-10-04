// 用法：node tools/frames.mjs <index.html 绝对路径> <输出目录> [fps] [t0] [t1]
// 逐帧截图到输出目录；没给 t0/t1 时渲整片。拼视频：ffmpeg -framerate <fps> -i <目录>/f%05d.jpg -c:v libx264 -pix_fmt yuv420p out.mp4
import { chromium } from "../../render/node_modules/playwright-core/index.mjs";
import { mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

const [html, out, fpsArg = "30", t0Arg, t1Arg] = process.argv.slice(2);
if (!html || !out) { console.error("用法见文件头"); process.exit(1); }
const fps = +fpsArg;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-gl=swiftshader", "--font-render-hinting=none"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.error("页面错误：", e.message));
page.on("console", (m) => m.type() === "error" && console.error("console:", m.text()));
await page.goto(`${pathToFileURL(html).href}?export&t=0`);
await page.waitForFunction(() => window.__ready && window.__ready.then, null, { timeout: 30000 });
await page.evaluate(() => window.__ready);
const duration = await page.evaluate(() => window.__duration);
const t0 = t0Arg == null ? 0 : +t0Arg, t1 = t1Arg == null ? duration : Math.min(duration, +t1Arg);
const n = Math.floor((t1 - t0) * fps);
console.log(`渲 ${n} 帧，${t0}–${t1.toFixed(2)} s，共 ${duration.toFixed(2)} s`);
for (let i = 0; i < n; i++) {
  const t = t0 + i / fps;
  await page.evaluate((t) => window.__seek(t), t);
  await page.screenshot({ path: `${out}/f${String(i).padStart(5, "0")}.jpg`, type: "jpeg", quality: 88 });
  if (i % 150 === 0) console.log(`${i}/${n}`);
}
await browser.close();
