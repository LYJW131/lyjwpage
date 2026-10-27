#!/usr/bin/env node
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { HIDE_DEV_UI, launchBrowser, resolvePlaywright } from "../../../../scripts/site-verify.ts";

const USAGE = `立绘截图：无头浏览器打开站点（深色模式），可选按科乐美秘技召唤青子，用假时钟定格到指定时刻截图。

  node .claude/skills/lyjwpage-character-art/scripts/capture.mjs --out <目录> [--url http://localhost:3211/] [--summon]
    [--at 0,2.5,8]                      第几秒各截一张；0 秒是召唤后 /mascots/ 请求停下之后，比显形起点晚零点几秒
                                        （要看显形从头开始，从 0 起用 --frames 连拍）
    [--frames 40 --step 16.7 --from 3]  从第 3 秒起每 16.7ms 一帧，共 40 帧（眨眼、头发逐帧）
    [--clip figure|face|viewport]       只截立绘画布、只截 FACE_BOX 那块脸，或整个视口
    [--face calm,grin --lid 0,1]        逐个强制表情与眼皮（先在代码里临时加 __aokoFace / __aokoLid，见 pipeline.md 第 3 节）
    [--engine webkit] [--width 1920 --height 1080 --dpr 2] [--reduced-motion]
    [--video]                           录一段真实时间的视频；加了它假时钟不停，--step 的间隔就不准了

假时钟装好就停住，只在脚本推进时前进，所以 --step 是精确的帧间隔。

截图写进 --out；最后一行打印 JSON：mounted 是否挂上了立绘（左侧留白太窄时本来就不挂），reloads 中途整页重载了几次（重载后已自动从头再按），
失败的 /mascots/ 请求（非 2xx 的响应和根本没拿到响应的都算），页面错误（已滤掉本地连不上后端这类环境噪音）。
宽屏按了秘技 mounted 仍是 false，或 mascots 非空，截出来的图就不能用。`;

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
const [SRC_W] = num("src/components/space-backdrop/aoko-figure.ts", /const SRC_W = (\d+);/);
const [PAD] = num("src/components/space-backdrop/aoko-figure.ts", /const PAD = (\d+);/);
const [REVEAL_S] = num("src/components/space-backdrop/aoko.ts", /const REVEAL_S = ([\d.]+);/);
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
// 连不上、DNS 失败这类请求没有响应，只会走到这里；立绘画布在贴图到齐前就已插入，光看画布在不在会把空图当成挂上了。
page.on("requestfailed", (r) => {
  if (r.url().includes("/mascots/")) mascots.add(`failed ${new URL(r.url()).pathname} ${r.failure()?.errorText ?? ""}`);
});

let loads = 0;
page.on("domcontentloaded", () => loads++);
await page.clock.install({ time: new Date("2026-10-26T12:00:00+08:00") });
await page.goto(a.url, { waitUntil: "domcontentloaded", timeout: 60000 });

const advance = async (ms) => {
  for (let left = ms; left > 0; left -= 250) await page.clock.runFor(Math.min(250, left));
};
const prepare = async () => {
  // install 之后假时钟仍跟着真实时间走，截图、写文件的耗时也会推进动画：停住后只在 runFor 时前进，逐帧间隔才准。停住的状态跨整页重载保留。
  if (!a.video) await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1));
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
  // 旧页面被重载打断的请求会记成失败，重来前清掉。
  if (attempt > 0) mascots.clear();
  try {
    await prepare();
  } catch (e) {
    if (loads === before) throw e;
  }
  if (loads === before) break;
  reloads += loads - before;
  await page.waitForLoadState("domcontentloaded");
}

// 立绘框（含四周 PAD）记在挂载点的 data-figure 上；画布要等渲染模块到了才插进去，有画布才算挂上。
const figureBox = () =>
  page.evaluate(() => {
    const root = document.querySelector("[data-figure]");
    if (!root?.querySelector("canvas")) return null;
    const [x, y, width, height] = root.dataset.figure.split(",").map(Number);
    return { x, y, width, height };
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
    // 假时钟按整毫秒走：每帧推进到累计时刻取整，16.7 ms 一帧时 17、17、16 交替，长了也不漂。
    await page.clock.runFor(Math.round((i + 1) * +a.step) - Math.round(i * +a.step));
  }
}
const faces = a.face.split(",").filter(Boolean);
const lids = a.lid.split(",").filter(Boolean).map(Number);
// 显形从脚往上，脸最后出来：没走完就截，强制的表情盖在还没显出的脸上。
if (faces.length) await goTo(REVEAL_S);
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
