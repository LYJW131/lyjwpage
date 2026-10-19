import fs from "node:fs";
import path from "node:path";

import { launchBrowser, PLAYWRIGHT_NEXT, resolvePlaywright, watchConsole, type PwBrowser, type PwPage } from "./browser.ts";
import { errorText, fail, print, stringFlag, type Box, type Flags } from "./cli.ts";
import { consoleClean, consoleProblems, navOrigin, newSink } from "./console-sink.ts";

type TextChange = { at: number; where: string; before: string; after: string };

const RELOAD_GRID = 16;
const OLD_PAGE_RGB = [255, 0, 255];

// 刷新前给旧页面盖一层纯色：Chromium 会保持旧页面直到新文档首次绘制，靠颜色分出哪一帧起是新页面。
const MARK_OLD_PAGE = `(() => {
  const mark = document.createElement("div");
  mark.style.cssText = "position:fixed;inset:0;z-index:2147483647;background:rgb(${OLD_PAGE_RGB.join(",")})";
  document.documentElement.append(mark);
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
})()`;

// 首个有内容的渲染帧之前（rAF 在样式表阻塞渲染期间不跑）先强制排版，再记各字体状态：排版要用的字体此刻会开始加载，
// 命中缓存的当场就是 loaded；还没加载完、最后又用上的字体，首帧画的就是回退字体。
// 不用 loadingdone 事件和 first-contentful-paint：前者派发晚于字体可用，后者在 Playwright 改了时钟后取不到。
// 从那一帧起记下每次文字变化：水合后才改的时间、晚到的卡片在 DOM 上都看得见，不靠录屏，WebKit 也能查。
const FIRST_PAINT_LOG = `(() => {
  window.__siteVerifyText = [];
  const describe = (el) => {
    const owner = el.closest("[id]");
    return (owner ? "#" + owner.id + " " : "") + el.tagName.toLowerCase();
  };
  const textOf = (nodes) => [...nodes]
    .filter((node) => node.nodeType === 3 || (node.nodeType === 1 && !["SCRIPT", "STYLE", "TEMPLATE", "LINK"].includes(node.nodeName)))
    .map((node) => node.textContent || "").join("").replace(/\\s+/g, " ").trim().slice(0, 60);
  new MutationObserver((records) => {
    // 解析器还在流式插入时的变化是首屏补齐，不算跳动。
    if (window.__siteVerifyPaintedAt === undefined || document.readyState === "loading") return;
    const at = Math.round(performance.now() - window.__siteVerifyPaintedAt);
    const batch = [];
    for (const record of records) {
      const el = record.type === "characterData" ? record.target.parentElement : record.target;
      if (!el || el.closest("script,style")) continue;
      // 看不见的（隐藏卡片、sr-only 文字）变了也不跳。
      const box = el.getBoundingClientRect();
      if (box.width * box.height <= 1 || (el.checkVisibility && !el.checkVisibility({ opacityProperty: true, visibilityProperty: true }))) continue;
      const before = record.type === "characterData" ? (record.oldValue || "").trim().slice(0, 60) : textOf(record.removedNodes);
      const after = record.type === "characterData" ? (record.target.data || "").trim().slice(0, 60) : textOf(record.addedNodes);
      if (before !== after) batch.push({ at, where: describe(el), before, after });
    }
    // 同一批里先拆后装、文字不变的（重新挂载）看不出变化，成对抵掉。
    for (const change of batch) {
      if (change.gone || change.before || !change.after) continue;
      const twin = batch.find((other) => !other.gone && other.where === change.where && other.before === change.after && !other.after);
      if (twin) change.gone = twin.gone = true;
    }
    for (const change of batch) if (!change.gone) window.__siteVerifyText.push(change);
  }).observe(document, { subtree: true, childList: true, characterData: true, characterDataOldValue: true });
  const check = () => {
    if (!document.body || !document.body.childElementCount) return requestAnimationFrame(check);
    window.__siteVerifyPaintedAt = performance.now();
    void document.body.offsetWidth;
    window.__siteVerifyFonts = [...document.fonts].map((face) => ({ family: face.family, weight: face.weight, status: face.status }));
  };
  requestAnimationFrame(check);
})()`;

const FONTS_AFTER_PAINT = `(() => {
  const loadedNow = new Set([...document.fonts].filter((face) => face.status === "loaded").map((face) => face.family + "|" + face.weight));
  return (window.__siteVerifyFonts ?? []).filter((face) => face.status !== "loaded" && loadedNow.has(face.family + "|" + face.weight));
})()`;

const FRAME_DIFF = `async ({ frames, grid, oldRgb, threshold }) => {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  let previous = null;
  const changed = [];
  const oldPage = [];
  let cols = 0;
  let rows = 0;
  for (const src of frames) {
    const image = new Image();
    image.src = src;
    await image.decode();
    canvas.width = image.width;
    canvas.height = image.height;
    ctx.drawImage(image, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, image.width, image.height);
    cols = Math.ceil(width / grid);
    rows = Math.ceil(height / grid);
    const centre = ((height >> 1) * width + (width >> 1)) * 4;
    oldPage.push(Math.abs(data[centre] - oldRgb[0]) + Math.abs(data[centre + 1] - oldRgb[1]) + Math.abs(data[centre + 2] - oldRgb[2]) < 30);
    const cells = [];
    if (previous && previous.length === data.length) {
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          let sum = 0;
          let count = 0;
          for (let y = row * grid; y < Math.min(height, (row + 1) * grid); y += 1) {
            for (let x = col * grid; x < Math.min(width, (col + 1) * grid); x += 1) {
              const i = (y * width + x) * 4;
              sum += Math.abs(data[i] - previous[i]) + Math.abs(data[i + 1] - previous[i + 1]) + Math.abs(data[i + 2] - previous[i + 2]);
              count += 1;
            }
          }
          if (sum / count > threshold) cells.push(row * cols + col);
        }
      }
    }
    changed.push(cells);
    previous = data;
  }
  return { changed, oldPage, cols, rows };
}`;

function cellRects(cells: number[], cols: number, grid: number): Box[] {
  const pending = new Set(cells);
  const rects: Box[] = [];
  for (const seed of cells) {
    if (!pending.has(seed)) continue;
    pending.delete(seed);
    const stack = [seed];
    let [minCol, maxCol, minRow, maxRow] = [Infinity, -Infinity, Infinity, -Infinity];
    while (stack.length) {
      const cell = stack.pop() as number;
      const row = Math.floor(cell / cols);
      const col = cell % cols;
      minCol = Math.min(minCol, col);
      maxCol = Math.max(maxCol, col);
      minRow = Math.min(minRow, row);
      maxRow = Math.max(maxRow, row);
      const neighbours = [col > 0 ? cell - 1 : -1, col < cols - 1 ? cell + 1 : -1, cell - cols, cell + cols];
      for (const next of neighbours) {
        if (pending.has(next)) {
          pending.delete(next);
          stack.push(next);
        }
      }
    }
    rects.push({ x: minCol * grid, y: minRow * grid, width: (maxCol - minCol + 1) * grid, height: (maxRow - minRow + 1) * grid });
  }
  return rects;
}

// 首次绘制之后：反复变化（≥ liveMin 次）的方格算常动区域；其余变过的方格按最后一次变化的帧归组，
// 过了 grace 才定下来的就是跳动（字体换装、时间从快照跳到此刻、卡片晚到都只变一两次）。
export function findJumps({ times, changed, oldPage, cols, grid = RELOAD_GRID, grace = 100, liveMin = 3 }: { times: number[]; changed: number[][]; oldPage: boolean[]; cols: number; grid?: number; grace?: number; liveMin?: number }) {
  const marked = oldPage.indexOf(true);
  const start = marked === -1 ? -1 : oldPage.findIndex((old, index) => index > marked && !old);
  if (start === -1) return { start: -1, jumps: [], live: [] };
  const count = new Map<number, number>();
  const last = new Map<number, number>();
  for (let frame = start + 1; frame < changed.length; frame += 1) {
    for (const cell of changed[frame] ?? []) {
      count.set(cell, (count.get(cell) ?? 0) + 1);
      last.set(cell, frame);
    }
  }
  const liveCells = [...count].filter(([, n]) => n >= liveMin).map(([cell]) => cell);
  const byFrame = new Map<number, number[]>();
  for (const [cell, frame] of last) {
    if ((count.get(cell) ?? 0) >= liveMin || (times[frame] ?? 0) - (times[start] ?? 0) <= grace) continue;
    byFrame.set(frame, [...(byFrame.get(frame) ?? []), cell]);
  }
  const jumps = [...byFrame]
    .sort(([a], [b]) => a - b)
    .flatMap(([frame, cells]) => cellRects(cells, cols, grid).map((rect) => ({ frame, atMs: Math.round((times[frame] ?? 0) - (times[start] ?? 0)), rect })));
  return { start, jumps, live: cellRects(liveCells, cols, grid) };
}

const DESCRIBE_AT = `(points) => points.map(({ x, y }) => {
  const el = document.elementFromPoint(x, y);
  if (!el) return null;
  const owner = el.closest("[id]");
  const text = (el.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 40);
  return [owner ? "#" + owner.id : null, el.tagName.toLowerCase(), text ? JSON.stringify(text) : null].filter(Boolean).join(" ");
})`;

async function screencastReload(page: PwPage, watch: number, latency: number) {
  const frames: { t: number; data: string }[] = [];
  const cdp = await page.context().newCDPSession(page);
  // 只拖慢真正走网络的请求（含重新验证），命中内存 / 磁盘缓存的不受影响，正好区分长缓存与每次重新验证的资源。
  if (latency) await cdp.send("Network.emulateNetworkConditions", { offline: false, latency, downloadThroughput: -1, uploadThroughput: -1 });
  cdp.on("Page.screencastFrame", async (frame) => {
    frames.push({ t: frame.metadata.timestamp * 1000, data: frame.data });
    await cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1 });
  await page.reload({ waitUntil: "commit" });
  await page.waitForTimeout(watch);
  await cdp.send("Page.stopScreencast");
  return frames;
}

// 文字差异阈值：screencast 是无损 PNG，6 足够滤掉抗锯齿抖动。
const DIFF_THRESHOLD = 6;

// 同一处文字反复变（歌词、进度、数字滚动）算常动；只变一两次的是跳动。
export function textJumps(changes: TextChange[], { grace = 100, liveMin = 3 } = {}) {
  const byWhere = new Map<string, TextChange[]>();
  for (const change of changes) {
    if (change.at <= grace) continue;
    byWhere.set(change.where, [...(byWhere.get(change.where) ?? []), change]);
  }
  const jumps: TextChange[] = [];
  const live: { where: string; count: number; sample: string | undefined }[] = [];
  for (const [where, list] of byWhere) {
    if (list.length >= liveMin) live.push({ where, count: list.length, sample: list.at(-1)?.after });
    else jumps.push(...list);
  }
  return { jumps: jumps.sort((a, b) => a.at - b.at), live };
}

export async function cmdReload(flags: Flags) {
  const out = stringFlag(flags.out) ?? fail("reload 需要 --out <目录>", "例子：reload --url http://localhost:3211 --out /tmp/reload", 2);
  const engine = flags.engine === "webkit" ? "webkit" : "chromium";
  const viewport = { width: Number(flags.width || 375), height: Number(flags.height || 1600) };
  const skewMinutes = Number(flags.skew ?? 2);
  const watch = Number(flags.watch || 5000);
  const grace = Number(flags.grace ?? 100);
  const latency = Number(flags.latency ?? 100);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });

  const pw = await resolvePlaywright() ?? fail("解不到 playwright / playwright-core", PLAYWRIGHT_NEXT);
  const sink = newSink();
  let browser: PwBrowser;
  try {
    browser = engine === "webkit" ? await pw.api.webkit.launch({ headless: true }) : (await launchBrowser(pw.api, flags)).browser;
  } catch (error) {
    fail(`起不来 ${engine}：${errorText(error).slice(0, 200)}`, engine === "webkit" ? "WebKit 要 Playwright 自带的构建：npx playwright install webkit，或 PLAYWRIGHT_BROWSERS_PATH 指向已装的目录" : "同 doctor 的 chrome 项");
  }
  try {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1, colorScheme: flags.theme === "light" ? "light" : "dark" });
    await context.addInitScript(FIRST_PAINT_LOG);
    const page = await context.newPage();
    watchConsole(page, sink, { origin: navOrigin(flags.url) });
    await page.goto(flags.url, { waitUntil: "load", timeout: 60_000 });
    await page.waitForTimeout(2000);
    if (skewMinutes) await context.clock.setSystemTime(Date.now() + skewMinutes * 60_000);
    let frames: { t: number; data: string }[] | null = null;
    if (engine === "chromium") {
      await page.evaluate(MARK_OLD_PAGE);
      frames = await screencastReload(page, watch, latency);
    } else {
      await page.reload({ waitUntil: "commit" });
      await page.waitForTimeout(watch);
    }

    const fontsAfterPaint = (await page.evaluate(FONTS_AFTER_PAINT)) as { family: string; weight: string; status: string }[];
    const text = textJumps((await page.evaluate("window.__siteVerifyText ?? []")) as TextChange[], { grace });
    await page.screenshot({ path: path.join(out, "settled.png") });

    let frameReport: { frames: number; jumps: { atMs: number; rect: Box; element: string | null | undefined; before: string | undefined; after: string | undefined }[]; live: { rect: Box; element: string | null | undefined }[] } | null = null;
    if (frames) {
      if (frames.length < 2) fail(`只录到 ${frames.length} 帧`, "加长 --watch 再试");
      const cols = Math.ceil(viewport.width / RELOAD_GRID);
      const rows = Math.ceil(viewport.height / RELOAD_GRID);
      const centres = Array.from({ length: cols * rows }, (_, cell) => ({ x: (cell % cols) * RELOAD_GRID + RELOAD_GRID / 2, y: Math.floor(cell / cols) * RELOAD_GRID + RELOAD_GRID / 2 }));
      const cellLabels = (await page.evaluate(`(${DESCRIBE_AT})(${JSON.stringify(centres)})`)) as (string | null)[];
      const label = (rect: Box) => cellLabels[Math.min(rows - 1, Math.floor((rect.y + rect.height / 2) / RELOAD_GRID)) * cols + Math.min(cols - 1, Math.floor((rect.x + rect.width / 2) / RELOAD_GRID))];
      const analysis = await context.newPage();
      const diff = (await analysis.evaluate(`(${FRAME_DIFF})(${JSON.stringify({ frames: frames.map((f) => `data:image/png;base64,${f.data}`), grid: RELOAD_GRID, oldRgb: OLD_PAGE_RGB, threshold: DIFF_THRESHOLD })})`)) as { changed: number[][]; oldPage: boolean[]; cols: number; rows: number };
      await analysis.close();
      const times = frames.map((f) => f.t);
      const { start, jumps, live } = findJumps({ times, changed: diff.changed, oldPage: diff.oldPage, cols: diff.cols, grace });
      if (start === -1) fail("没录到新页面的首帧（旧页面遮罩之后没有新画面）", "加长 --watch，或先确认页面能打开");
      const startTime = times[start] ?? 0;
      const names = frames.map((frame, index) => `frame-${String(index).padStart(3, "0")}-${Math.round(frame.t - startTime)}ms.png`);
      frames.forEach((frame, index) => {
        if (index >= start) fs.writeFileSync(path.join(out, names[index] ?? ""), Buffer.from(frame.data, "base64"));
      });
      frameReport = {
        frames: frames.length - start,
        jumps: jumps.map((jump) => ({ atMs: jump.atMs, rect: jump.rect, element: label(jump.rect), before: names[Math.max(start, jump.frame - 1)], after: names[jump.frame] })),
        live: live.map((rect) => ({ rect, element: label(rect) })),
      };
    }

    const report = {
      engine,
      viewport,
      skewMinutes,
      latencyMs: engine === "chromium" ? latency : null,
      fontsAfterPaint,
      textJumps: text.jumps,
      liveText: text.live,
      ...(frameReport ? { frameJumps: frameReport.jumps, liveRegions: frameReport.live, frames: frameReport.frames } : {}),
    };
    const frameJumps = frameReport?.jumps.length ?? 0;
    const ok = frameJumps === 0 && text.jumps.length === 0 && fontsAfterPaint.length === 0 && consoleClean(sink);
    const next = ok
      ? undefined
      : [
          text.jumps.length ? `首次绘制后有 ${text.jumps.length} 处文字只变了一两次：逐条看 before → after，是首帧没画对（时间锚在快照、水合补内容）还是数据刷新` : null,
          frameJumps ? `录屏里首次绘制后有 ${frameJumps} 处画面跳动：对照 before / after 帧` : null,
          fontsAfterPaint.length ? `首帧时字体还没加载完：${[...new Set(fontsAfterPaint.map((f) => f.family))].join(", ")}，首帧画的是回退字体` : null,
          consoleClean(sink) ? null : `控制台不干净：${consoleProblems(sink)}`,
        ].filter(Boolean).join("；");
    print({ ok, ...(next ? { next } : {}), out: path.resolve(out), ...report, console: sink }, flags);
    if (!ok) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}
