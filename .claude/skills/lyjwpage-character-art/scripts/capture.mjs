#!/usr/bin/env node
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { HIDE_DEV_UI, launchBrowser, resolvePlaywright } from "../../../../scripts/site-verify.ts";

const USAGE = `立绘截图：无头浏览器打开站点（深色模式），可选按科乐美秘技召唤青子，用假时钟定格到指定时刻截图。

  node .claude/skills/lyjwpage-character-art/scripts/capture.mjs --out <目录> [--url http://localhost:3211/] [--summon]
    [--at 0,2.5,8]                      召唤并加载完后第几秒各截一张
    [--frames 40 --step 16.7 --from 3]  从第 3 秒起每 16.7ms 一帧，共 40 帧（眨眼、头发逐帧）
    [--clip figure|face|viewport]       只截立绘画布、只截 FACE_BOX 那块脸，或整个视口
    [--face calm,grin --lid 0,1]        逐个强制表情与眼皮（先在代码里临时加 __aokoFace / __aokoLid，见 pipeline.md 第 3 节）
    [--engine webkit] [--width 1920 --height 1080 --dpr 2] [--reduced-motion] [--video]

截图写进 --out；最后一行打印 JSON：mounted 是否挂上了立绘（左侧留白太窄时本来就不挂），reloads 中途整页重载了几次（重载后已自动从头再按），
失败的 /mascots/ 请求，页面错误（已滤掉本地连不上后端这类环境噪音）。宽屏按了秘技 mounted 仍是 false，截出来的图就不能用。`;

const { values: a } = parseArgs({
  strict: true,
  options: {
    help: { type: "boolean", short: "h", default: false },
    url: { type: "string", default: "http://localhost:3211/" },
    out: { type: "string" },
    summon: { type: "boolean", default: false },
    at: { type: "string", default: "" },
    frames: { type: "string", default: "0" },
    step: { type: "string", default: "16.7" },
    from: { type: "string", default: "0" },
    clip: { type: "string", default: "figure" },
    face: { type: "string", default: "" },
    lid: { type: "string", default: "" },
    engine: { type: "string", default: "chromium" },
    width: { type: "string", default: "1920" },
    height: { type: "string", default: "1080" },
    dpr: { type: "string", default: "2" },
    "reduced-motion": { type: "boolean", default: false },
    video: { type: "boolean", default: false },
  },
});
if (a.help) {
  console.log(USAGE);
  process.exit(0);
}
if (!a.out) {
  console.error(USAGE);
  process.exit(2);
}
mkdirSync(a.out, { recursive: true });

const repo = new URL("../../../../", import.meta.url).pathname;
const num = (file, re) => {
  const m = readFileSync(join(repo, file), "utf8").match(re);
  if (!m) throw new Error(`${file} 里没找到 ${re}`);
  return m.slice(1).map(Number);
};
const [SRC_W] = num("src/components/space-backdrop/aoko.ts", /const SRC_W = (\d+);/);
const [PAD] = num("src/components/space-backdrop/aoko.ts", /const PAD = (\d+);/);
const FACE_BOX = num("src/components/space-backdrop/aoko-face.ts", /FACE_BOX = \[(\d+), (\d+), (\d+)\]/);

const pw = (await resolvePlaywright())?.api;
if (!pw) throw new Error("找不到 Playwright：先在仓库里 pnpm install");
const browser = a.engine === "webkit" ? await pw.webkit.launch({ headless: true }) : (await launchBrowser(pw)).browser;
const ctx = await browser.newContext({
  viewport: { width: +a.width, height: +a.height },
  deviceScaleFactor: +a.dpr,
  colorScheme: "dark",
  reducedMotion: a["reduced-motion"] ? "reduce" : "no-preference",
  ...(a.video ? { recordVideo: { dir: a.out, size: { width: +a.width, height: +a.height } } } : {}),
});
const page = await ctx.newPage();
const errors = [];
const noise = /dev\/overrides|Access-Control|CORS|ERR_FAILED|ERR_CONNECTION_REFUSED/;
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => m.type() === "error" && !noise.test(m.text()) && errors.push(m.text()));
const mascots = new Set();
page.on("response", (r) => {
  if (r.url().includes("/mascots/")) mascots.add(`${r.status()} ${new URL(r.url()).pathname}`);
});

let loads = 0;
page.on("domcontentloaded", () => loads++);
await page.clock.install({ time: new Date("2026-10-26T12:00:00+08:00") });
await page.goto(a.url, { waitUntil: "domcontentloaded", timeout: 60000 });

const advance = async (ms) => {
  for (let left = ms; left > 0; left -= 250) await page.clock.runFor(Math.min(250, left));
};
const prepare = async () => {
  mascots.clear();
  await page.addStyleTag({ content: HIDE_DEV_UI });
  await page.clock.runFor(4000);
  await page.waitForTimeout(1500);
  if (a.summon) {
    await page.mouse.click(5, Math.round(+a.height / 3));
    for (const key of ["ArrowUp", "ArrowUp", "ArrowDown", "ArrowDown", "ArrowLeft", "ArrowRight", "ArrowLeft", "ArrowRight", "b", "a", "Enter"]) {
      await page.keyboard.press(key);
      await page.clock.runFor(160);
    }
  }
  // 贴图到齐之前立绘不开始计时：按真实时间等 /mascots/ 的请求停下来，期间让假时钟慢慢走。
  let seen = -1;
  for (let quiet = 0, i = 0; quiet < 4 && i < 80; i++) {
    await page.clock.runFor(100);
    await page.waitForTimeout(250);
    quiet = mascots.size === seen ? quiet + 1 : 0;
    seen = mascots.size;
  }
};
// Vite 冷启动预构建完依赖会整页重载一次，重载前加的样式和按下的秘技随旧页面一起没了：发现重载就从头再来。
let reloads = 0;
for (let attempt = 0; attempt < 3; attempt++) {
  const before = loads;
  try {
    await prepare();
  } catch (e) {
    if (loads === before) throw e;
  }
  if (loads === before) break;
  reloads += loads - before;
  await page.waitForLoadState("domcontentloaded");
}

const figureBox = () =>
  page.evaluate(() => {
    const c = [...document.querySelectorAll("canvas")].find((el) => el.style.filter.includes("drop-shadow"));
    if (!c) return null;
    const r = c.getBoundingClientRect();
    return { x: r.left, y: r.top, width: r.width, height: r.height };
  });
const clipFor = async () => {
  if (a.clip === "viewport") return undefined;
  const box = await figureBox();
  if (!box) return undefined;
  if (a.clip === "figure") return box;
  const k = box.width / (SRC_W + 2 * PAD);
  return { x: box.x + (PAD + FACE_BOX[0]) * k, y: box.y + (PAD + FACE_BOX[1]) * k, width: FACE_BOX[2] * k, height: FACE_BOX[2] * k };
};
const shot = async (name) => page.screenshot({ path: join(a.out, `${name}.png`), clip: await clipFor() });
const mounted = (await figureBox()) !== null;

let now = 0;
const goTo = async (t) => {
  await advance(Math.max(0, (t - now) * 1000));
  now = Math.max(now, t);
};
for (const t of a.at.split(",").filter(Boolean).map(Number)) {
  await goTo(t);
  await shot(`at-${t}`);
}
if (+a.frames > 0) {
  await goTo(+a.from);
  for (let i = 0; i < +a.frames; i++) {
    await shot(`f${String(i).padStart(3, "0")}`);
    await page.clock.runFor(+a.step);
  }
}
const faces = a.face.split(",").filter(Boolean);
const lids = a.lid.split(",").filter(Boolean).map(Number);
for (const face of faces) {
  for (const lid of lids.length ? lids : [0]) {
    await page.evaluate(([f, l]) => Object.assign(window, { __aokoFace: f, __aokoLid: l }), [face, lid]);
    await page.clock.runFor(100);
    await shot(`face-${face}-lid${lid}`);
  }
}

await ctx.close();
await browser.close();
console.log(JSON.stringify({ mounted, reloads, mascots: [...mascots].filter((m) => !m.startsWith("2")), errors }));
