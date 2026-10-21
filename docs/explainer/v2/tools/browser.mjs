import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../../render/node_modules/playwright-core/index.mjs";

export const PAGE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../index.html");

// 云端容器没有 GPU 也没有 Chrome 频道，WebGL 只能走 Playwright 自带 Chromium 的 SwiftShader；Mac 上用本机 Chrome 的 Metal。
const BUNDLED = "/opt/pw-browsers/chromium";
const SOFTWARE = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];
const METAL = ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"];

export function launch() {
  const args = process.platform === "darwin" ? METAL : SOFTWARE;
  if (process.env.CHROME_PATH) return chromium.launch({ executablePath: process.env.CHROME_PATH, headless: true, args });
  if (process.platform === "darwin") return chromium.launch({ channel: "chrome", headless: true, args });
  return chromium.launch({ executablePath: fs.existsSync(BUNDLED) ? BUNDLED : undefined, headless: true, args });
}

// 还没写的章加载失败是预期的，由占位画面顶上（CONVENTIONS「文件与分工」）。
const expectedMissing = (m) => /Failed to load resource|ERR_FILE_NOT_FOUND/.test(m.text()) && /\/(music\/)?ch\d\d\.js$/.test(m.location()?.url || "");

// base：从这个 http 地址（根是 docs/explainer）取页面；file:// 下 fetch 取不到配乐和音效，要声音时用它
export async function openFilm(browser, { lang = "zh", scale = 0.5, only = "", check = false, init, base } = {}) {
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: scale });
  // GPU 画布画线段端点的抗锯齿随上一帧画过什么而变（同一时刻乱序 seek 差一两个像素），逐帧比对会误报；工具里一律让 2D 图层走 CPU 光栅。
  await context.addInitScript(() => {
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, opts) {
      return get.call(this, kind, kind === "2d" ? { ...opts, willReadFrequently: true } : opts);
    };
  });
  if (init) await context.addInitScript(init);
  const page = await context.newPage();
  const errors = [], missing = new Set();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => {
    if (expectedMissing(m)) return;
    if (m.type() === "warning" && m.text().startsWith("缺文字")) missing.add(m.text().replace(/^缺文字：\s*/, ""));
    else if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  const query = ["export", check && "check", `lang=${lang}`, only && `only=${only}`].filter(Boolean).join("&");
  await page.goto(`${base ? `${base}/v2/index.html` : `file://${PAGE}`}?${query}`);
  await page.evaluate(() => window.__ready);
  const film = await page.evaluate(() => ({ duration: window.__duration, BAR: window.__BAR, chapters: window.__chapters }));
  return { page, errors, missing, film };
}
