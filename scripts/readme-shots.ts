#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import sharp from "sharp";

import { ROOT } from "./dev-fixtures.ts";
import { applyScene } from "./dev-scene.ts";
import { HIDE_DEV_UI, launchBrowser, resolvePlaywright } from "./site-verify.ts";

const USAGE = `用法：pnpm readme:shots [--scene <场景>] [--theme light|dark|both] [--out <目录>]

先用 pnpm dev:scene 注入整份场景（默认 readme），再在 1280 宽、2 倍像素密度下截根 README 的首页总览图，
明暗各一份，转 WebP 写进 docs/screenshots/。注入一次、明暗两轮读同一份数据，标题池已收成一句。
前置：pnpm dev:worker 与 pnpm dev:local 在跑（不在默认端口时用 SITE_URL / DEV_WORKER_URL）。浏览器的启动顺序与 site-verify 相同，SITE_VERIFY_CHROME 可指定路径。
场景留在本地 Worker 里供对照，收尾 pnpm dev:scene --reset。各卡片不截图，见 docs/screenshots.md「实时卡片」。`;

type Page = {
  goto(url: string, options: { waitUntil: "load"; timeout: number }): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  evaluate(expression: string): Promise<unknown>;
  addStyleTag(options: { content: string }): Promise<unknown>;
  screenshot(options: { fullPage?: boolean; scale?: "device" }): Promise<Buffer>;
};
type Browser = { newContext(options: Record<string, unknown>): Promise<{ newPage(): Promise<Page> }>; close(): Promise<void> };

const SCALE = 2;
const VIEWPORT = { width: 1280, height: 2200 };
const SETTLE_MS = 4_000;
const IMAGE_WAIT_MS = 15_000;
const WEBP_QUALITY = 88;

async function captureTheme(browser: Browser, url: string, theme: "light" | "dark", out: string): Promise<string> {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: SCALE, colorScheme: theme });
  const page = await context.newPage();
  await page.goto(url, { waitUntil: "load", timeout: 60_000 });
  await page.addStyleTag({ content: HIDE_DEV_UI });
  await page.waitForTimeout(SETTLE_MS);
  await page.evaluate(`(async () => { for (let y = 0; y < document.body.scrollHeight + 1200; y += 600) { scrollTo(0, y); await new Promise((r) => setTimeout(r, 60)); } scrollTo(0, 0); })()`);
  // 图片默认懒加载，滚动只触发请求；等触发过的都落地再截，冷缓存下总览底部才不缺图。
  await page.evaluate(`Promise.race([
    Promise.all([...document.images].filter((img) => img.loading !== "lazy" || img.currentSrc).map((img) => img.complete ? null : new Promise((r) => { img.addEventListener("load", r, { once: true }); img.addEventListener("error", r, { once: true }); }))),
    new Promise((r) => setTimeout(r, ${IMAGE_WAIT_MS})),
  ])`);
  const file = path.join(out, `overview-${theme}.webp`);
  await sharp(await page.screenshot({ fullPage: true, scale: "device" })).webp({ quality: WEBP_QUALITY }).toFile(file);
  return path.relative(ROOT, file);
}

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main(args: string[]): Promise<unknown> {
  const scene = flag(args, "--scene") ?? "readme";
  const theme = flag(args, "--theme") ?? "both";
  const out = path.resolve(flag(args, "--out") ?? path.join(ROOT, "docs", "screenshots"));
  const url = process.env.SITE_URL ?? `http://localhost:${process.env.DEV_SITE_PORT || "3211"}/`;
  const themes = theme === "both" ? (["light", "dark"] as const) : ([theme === "dark" ? "dark" : "light"] as const);
  const applied = await applyScene(scene);
  const pw = (await resolvePlaywright())?.api;
  if (!pw) throw new Error("解不到 playwright / playwright-core（node scripts/site-verify.ts doctor 看原因）");
  fs.mkdirSync(out, { recursive: true });
  const browser = (await launchBrowser(pw)).browser as unknown as Browser;
  try {
    const written: string[] = [];
    for (const each of themes) written.push(await captureTheme(browser, url, each, out));
    return { ok: true, scene: applied, written, next: "看完图后 pnpm dev:scene --reset 清掉注入" };
  } finally {
    await browser.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  if (process.argv.includes("--help")) {
    console.log(USAGE);
  } else {
    try {
      console.log(JSON.stringify(await main(process.argv.slice(2)), null, 2));
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    }
  }
}
