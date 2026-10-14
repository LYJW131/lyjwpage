#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import sharp from "sharp";

import { ROOT } from "./dev-fixtures.ts";
import { applyScene } from "./dev-scene.ts";
import { HIDE_DEV_UI, launchBrowser, resolvePlaywright } from "./site-verify.ts";

const USAGE = `用法：pnpm readme:shots [--scene <场景>] [--only <名[,名]>] [--theme light|dark|both] [--out <目录>]

先用 pnpm dev:scene 注入整份场景（默认 readme），再按 SHOTS 清单在 1280 宽、2 倍像素密度下截根 README 的静态效果图，
明暗各一份，转 WebP 写进 docs/screenshots/。注入一次、明暗两轮读同一份数据，标题池已收成一句。
前置：pnpm dev:worker 与 pnpm dev:local 在跑（不在默认端口时用 SITE_URL / DEV_WORKER_URL）。浏览器的启动顺序与 site-verify 相同，SITE_VERIFY_CHROME 可指定路径。
场景留在本地 Worker 里供对照，收尾 pnpm dev:scene --reset。会动的卡片见 scripts/card-gifs.py。`;

type Box = { x: number; y: number; width: number; height: number };
type Page = {
  goto(url: string, options: { waitUntil: "load"; timeout: number }): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  evaluate(expression: string): Promise<unknown>;
  addStyleTag(options: { content: string }): Promise<unknown>;
  screenshot(options: { clip?: Box; fullPage?: boolean; scale?: "device" }): Promise<Buffer>;
  hover(selector: string): Promise<void>;
};
type Browser = { newContext(options: Record<string, unknown>): Promise<{ newPage(): Promise<Page> }>; close(): Promise<void> };

export type Shot = {
  name: string;
  find: string;
  prepare?: (page: Page, box: Box) => Promise<Box[]>;
};

const SCALE = 2;
const VIEWPORT = { width: 1280, height: 2200 };
const PAD = 12;
const SETTLE_MS = 4_000;
const IMAGE_WAIT_MS = 15_000;
const WEBP_QUALITY = 88;

const JS_EMBED_ESCAPE: Record<string, string> = { "<": "\\u003C", ">": "\\u003E", "/": "\\u002F", "\u2028": "\\u2028", "\u2029": "\\u2029" };

// JSON.stringify 留下 <>/ 与 U+2028/U+2029，嵌进脚本字面量时要再写成 \uXXXX。
export const jsLiteral = (value: string) => JSON.stringify(value).replace(/[<>/\u2028\u2029]/g, (char) => JS_EMBED_ESCAPE[char]);

const byId = (id: string) => `document.getElementById(${jsLiteral(id)})`;
export const byLabel = (label: string) =>
  `[...document.querySelectorAll(".paper-card")].find((card) => card.querySelector(".label-mono")?.textContent.trim() === ${jsLiteral(label)})`;

async function boxOf(page: Page, find: string, scroll = true): Promise<Box | null> {
  return (await page.evaluate(`(() => {
    const el = ${find};
    if (!el) return null;
    if (${scroll}) el.scrollIntoView({ block: "center", behavior: "instant" });
    const r = el.getBoundingClientRect();
    return r.width && r.height ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
  })()`)) as Box | null;
}

// 浮层画在卡片之外，要和卡片的框取并集；它挂在 body 上，不在卡片的兄弟里。
// 框一律按视口坐标量、按视口截：整页截图会把视口拉高重排，悬停出来的浮层随之收起。
const tooltipBox = `(() => {
  const r = document.querySelector('[role="tooltip"]')?.getBoundingClientRect();
  return r && r.width ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
})()`;

export const SHOTS: Shot[] = [
  { name: "now-watching", find: byId("now-watching") },
  { name: "powerbank", find: byLabel("Power Bank") },
  {
    name: "playstation-trophies",
    find: byId("playing"),
    prepare: async (page) => {
      await page.evaluate(`${byId("playing")}?.querySelector("button[aria-expanded]")?.click()`);
      await page.waitForTimeout(1_500);
      return [];
    },
  },
  {
    name: "pulse-detail",
    find: byLabel("Pulse"),
    prepare: async (page) => {
      // readme 场景里听歌道正中是一长段播放；空闲处悬停不出浮层。hover 自己等元素稳定再移指针，手算坐标会被晚到的排版带偏。
      await page.hover('button[aria-label^="Listening:"]');
      await page.waitForTimeout(600);
      const tip = (await page.evaluate(tooltipBox)) as Box | null;
      return tip ? [tip] : [];
    },
  },
  { name: "site-status", find: byId("site-status") },
];

export function unionBox(boxes: Box[], pad = PAD): Box {
  const left = Math.min(...boxes.map((b) => b.x)) - pad;
  const top = Math.min(...boxes.map((b) => b.y)) - pad;
  const right = Math.max(...boxes.map((b) => b.x + b.width)) + pad;
  const bottom = Math.max(...boxes.map((b) => b.y + b.height)) + pad;
  return { x: Math.max(0, left), y: Math.max(0, top), width: right - Math.max(0, left), height: bottom - Math.max(0, top) };
}

// 边距里会露出邻居卡片的边：沿祖先链把目标之外的兄弟都藏掉，浮层（body 的直接子节点）不动。
async function isolate(page: Page, find: string): Promise<void> {
  await page.evaluate(`(() => {
    const target = ${find};
    for (let node = target; node && node.parentElement && node.parentElement !== document.body; node = node.parentElement) {
      for (const sibling of node.parentElement.children) {
        if (sibling !== node) sibling.style.visibility = "hidden";
      }
    }
  })()`);
}

async function captureTheme(browser: Browser, url: string, theme: "light" | "dark", shots: Shot[], overview: boolean, out: string): Promise<string[]> {
  const written: string[] = [];
  const open = async () => {
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
    return page;
  };
  const save = async (name: string, png: Buffer) => {
    const file = path.join(out, `${name}-${theme}.webp`);
    await sharp(png).webp({ quality: WEBP_QUALITY }).toFile(file);
    written.push(path.relative(ROOT, file));
  };
  if (overview) {
    const page = await open();
    await save("overview", await page.screenshot({ fullPage: true, scale: "device" }));
  }
  // 每张卡一页新开：藏邻居、展开、悬停都会改页面，留到下一张会串味。
  for (const shot of shots) {
    const page = await open();
    const box = await boxOf(page, shot.find);
    if (!box) throw new Error(`${shot.name}：卡片在当前数据下不显示，检查场景是否点亮了它`);
    const extra = (await shot.prepare?.(page, box)) ?? [];
    await isolate(page, shot.find);
    // 再量一次不能滚动：悬停出来的浮层会因指针离开而收起。
    const settled = (await boxOf(page, shot.find, false)) ?? box;
    await save(shot.name, await page.screenshot({ clip: unionBox([settled, ...extra]), scale: "device" }));
  }
  return written;
}

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function main(args: string[]): Promise<unknown> {
  const scene = flag(args, "--scene") ?? "readme";
  const only = flag(args, "--only")?.split(",");
  const theme = flag(args, "--theme") ?? "both";
  const out = path.resolve(flag(args, "--out") ?? path.join(ROOT, "docs", "screenshots"));
  const url = process.env.SITE_URL ?? `http://localhost:${process.env.DEV_SITE_PORT || "3211"}/`;
  const shots = only ? SHOTS.filter((shot) => only.includes(shot.name)) : SHOTS;
  const overview = !only || only.includes("overview");
  const themes = theme === "both" ? (["light", "dark"] as const) : ([theme === "dark" ? "dark" : "light"] as const);
  const applied = await applyScene(scene);
  const pw = (await resolvePlaywright())?.api;
  if (!pw) throw new Error("解不到 playwright / playwright-core（node scripts/site-verify.ts doctor 看原因）");
  fs.mkdirSync(out, { recursive: true });
  const browser = (await launchBrowser(pw)).browser as unknown as Browser;
  try {
    const written: string[] = [];
    for (const each of themes) written.push(...(await captureTheme(browser, url, each, shots, overview, out)));
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
