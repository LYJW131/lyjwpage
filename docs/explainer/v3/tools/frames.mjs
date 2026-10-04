// 用法：node tools/frames.mjs <index.html 绝对路径或 http 地址（ES module 必须走 http）> <输出目录> [fps] [t0] [t1]
// 逐帧截图到输出目录；没给 t0/t1 时渲整片。环境变量 WIDTH 改输出宽度（默认 1920；无头软渲染很慢，预览可用 1280）。拼视频：ffmpeg -framerate <fps> -i <目录>/f%05d.jpg -c:v libx264 -pix_fmt yuv420p out.mp4
import { chromium } from "../../render/node_modules/playwright-core/index.mjs";
import { mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";

const [html, out, fpsArg = "30", t0Arg, t1Arg] = process.argv.slice(2);
if (!html || !out) { console.error("用法见文件头"); process.exit(1); }
const fps = +fpsArg;
mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist", "--font-render-hinting=none"] });
const W = +(process.env.WIDTH || 1920);
const page = await browser.newPage({ viewport: { width: W, height: Math.round((W * 9) / 16) }, deviceScaleFactor: 1 });
page.on("pageerror", (e) => console.error("页面错误：", e.message));
page.on("console", (m) => ["error", "warning"].includes(m.type()) && console.error("console:", m.text()));
page.on("requestfailed", (r) => console.error("加载失败：", r.url(), r.failure()?.errorText));
await page.goto(`${/^https?:/.test(html) ? html : pathToFileURL(html).href}?export&t=0`);
await page.waitForFunction(() => window.__ready && window.__ready.then, null, { timeout: 60000 });
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
