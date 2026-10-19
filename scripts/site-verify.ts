#!/usr/bin/env node
import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
const MAP_PATH = path.join(ROOT, ".claude", "skills", "lyjwpage-verify", "feature-map.json");
const DEV_OVERRIDE = path.join(ROOT, "scripts", "dev-override.ts");
const RENDER_PLAYWRIGHT = path.join(ROOT, "docs", "explainer", "render", "node_modules", "playwright-core", "index.mjs");

type Flags = { [key: string]: string | boolean | undefined; url: string };
type Box = { x: number; y: number; width: number; height: number };
type FailedRequest = { url: string; status: number | null; error?: string; sameOrigin: boolean };
export type Sink = { errors: string[]; warnings: string[]; pageErrors: string[]; envNoise: string[]; failedRequests: FailedRequest[] };
type CardEntry = { component: string; selector?: string; alternates?: string[]; cardLabel?: string; conditional?: boolean; endpoints?: Record<string, string[]>; proves?: unknown };
export type FeatureMap = { cards: Record<string, CardEntry> };
type CardSpec = { id: string; selector?: string; alternates?: string[]; cardLabel?: string };
type Located = { visible: boolean; box: Box } | null;
type TextChange = { at: number; where: string; before: string; after: string };
type Viewport = { width: number; height: number };

type PwRequest = {
  url(): string;
  method(): string;
  failure(): { errorText: string } | null;
  isNavigationRequest(): boolean;
  frame(): PwFrame;
  resourceType(): string;
};
type PwResponse = { url(): string; status(): number; request(): PwRequest; text(): Promise<string> };
type PwFrame = { url(): string };
type PwConsoleMessage = { text(): string; type(): string };
type PwElement = { scrollIntoViewIfNeeded(): Promise<void>; screenshot(options: { path: string }): Promise<unknown> };
type PwRoute = {
  request(): PwRequest;
  continue(): Promise<void>;
  fetch(): Promise<PwResponse>;
  fulfill(options: { status?: number; contentType?: string; body?: string; response?: PwResponse }): Promise<void>;
};
type PwCdpSession = {
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  on(event: "Page.screencastFrame", handler: (frame: { data: string; sessionId: number; metadata: { timestamp: number } }) => void): void;
};
type PwPage = {
  on(event: "framenavigated", handler: (frame: PwFrame) => void): void;
  on(event: "console", handler: (message: PwConsoleMessage) => void): void;
  on(event: "pageerror", handler: (error: Error) => void): void;
  on(event: "response", handler: (response: PwResponse) => void): void;
  on(event: "request" | "requestfailed", handler: (request: PwRequest) => void): void;
  mainFrame(): PwFrame;
  goto(url: string, options: { waitUntil: "load"; timeout: number }): Promise<unknown>;
  reload(options: { waitUntil: "commit" }): Promise<unknown>;
  waitForTimeout(ms: number): Promise<void>;
  evaluate(expression: string): Promise<unknown>;
  addStyleTag(options: { content: string }): Promise<unknown>;
  evaluateHandle(expression: string): Promise<{ asElement(): PwElement | null }>;
  screenshot(options: { path: string; fullPage?: boolean }): Promise<unknown>;
  route(matcher: (url: URL) => boolean, handler: (route: PwRoute) => Promise<void>): Promise<void>;
  context(): PwContext;
  close(): Promise<void>;
};
type PwContext = {
  newPage(): Promise<PwPage>;
  addInitScript(script: string): Promise<void>;
  newCDPSession(page: PwPage): Promise<PwCdpSession>;
  clock: { setSystemTime(time: number): Promise<void> };
};
type PwBrowser = {
  newContext(options: Record<string, unknown>): Promise<PwContext>;
  version(): string;
  close(): Promise<void>;
};
type PwBrowserType = { launch(options: Record<string, unknown>): Promise<PwBrowser> };
type PwApi = { chromium: PwBrowserType; webkit: PwBrowserType };

const errorText = (error: unknown) => String((error as { message?: unknown } | null)?.message ?? error);
const stringFlag = (value: string | boolean | undefined) => (typeof value === "string" ? value : undefined);

const DEFAULT_URL = `http://localhost:${process.env.DEV_SITE_PORT || "3211"}`;
const WORKER_URL = (process.env.DEV_WORKER_URL || "http://localhost:8788").replace(/\/+$/, "");
const HEIGHT_BY_WIDTH: Record<number, number> = { 375: 812, 768: 1024, 820: 1180, 1024: 768, 1280: 900, 1440: 900 };
// 环境噪声不是站点错误（SKILL.md 约定）：容器代理把 WebSocket 升级挡成 426，消息里必须同时有 426 才豁免；
// Vite dev 重优化依赖时偶发 504。其它 ws 失败（鉴权、路由、5xx）照常算。
const ENV_NOISE = [
  /WebSocket connection to '\w+:\/\/[^']*\/ws[^']*' failed.*\b426\b/i,
  /Outdated Optimize Dep/,
];

export function isEnvNoise(text: string): boolean {
  return ENV_NOISE.some((pattern) => pattern.test(text));
}

export function parseArgs(argv: string[]): { flags: Record<string, string | true>; positional: string[] } {
  const flags: Record<string, string | true> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? "";
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    if (eq !== -1) {
      flags[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else if (i + 1 < argv.length && !(argv[i + 1] ?? "").startsWith("--")) {
      flags[arg.slice(2)] = argv[i + 1] ?? "";
      i += 1;
    } else {
      flags[arg.slice(2)] = true;
    }
  }
  return { flags, positional };
}

export function parseWidths(value: unknown): Viewport[] | null {
  const list = String(value ?? "1280,375").split(",").map((w) => Number(w.trim()));
  if (list.some((w) => !Number.isInteger(w) || w < 200 || w > 4000)) return null;
  return list.map((width) => ({ width, height: HEIGHT_BY_WIDTH[width] ?? 900 }));
}

export function loadFeatureMap(mapPath = MAP_PATH): FeatureMap | null {
  if (!fs.existsSync(mapPath)) return null;
  return JSON.parse(fs.readFileSync(mapPath, "utf8")) as FeatureMap;
}

// 归一化「这条控制台面干不干净」：cards 与 shot 同一份判据，envNoise 不算。
export function consoleClean(sink: Sink): boolean {
  return (
    sink.errors.length === 0 &&
    sink.pageErrors.length === 0 &&
    !sink.failedRequests.some((request) => request.sameOrigin)
  );
}

export function newSink(): Sink {
  return { errors: [], warnings: [], pageErrors: [], envNoise: [], failedRequests: [] };
}

// 返回 "noise" | "same-origin" | "external"。noise 只放确定的环境原因：/favicon.ico 是浏览器自动探测
// （站点图标在 /icon，生产同样 404）；WebSocket 升级只豁免容器代理回的 426，requestfailed 没有状态码、
// 其它 ws 失败（鉴权 4xx、路由、5xx、断网）一律按源分类，同源计入失败。
export function classifyRequest(url: string, status: number | null, origin: string | null): "noise" | "same-origin" | "external" {
  const parsed = new URL(url);
  if (parsed.pathname === "/favicon.ico") return "noise";
  const isWebSocket = parsed.protocol === "ws:" || parsed.protocol === "wss:";
  if ((isWebSocket || parsed.pathname === "/ws") && status === 426) return "noise";
  if (!origin) return "external";
  // ws(s): 的 origin 是 ws 方案、和 http(s) origin 比不等；同站 ws 按 host 相等判。
  const sameOrigin = isWebSocket ? parsed.host === new URL(origin).host : parsed.origin === origin;
  return sameOrigin ? "same-origin" : "external";
}

// 导航目的地的 origin；about:blank / data: / chrome-error: 这类没有有效 origin 的返回 null，由调用方决定保不保留旧值。
export function navOrigin(url: string): string | null {
  const origin = new URL(url).origin;
  return origin === "null" ? null : origin;
}

export function updateOrigin(current: { origin: string | null }, url: string): string | null {
  const origin = navOrigin(url);
  if (origin) current.origin = origin;
  return current.origin;
}

// --card 显式点名就是期望它出现：conditional 卡被点名时也算 required。
export function requiredCardIds(map: { cards: Record<string, { conditional?: boolean }> }, wanted: string[], explicit: boolean): string[] {
  return explicit ? wanted : wanted.filter((id) => !map.cards[id]?.conditional);
}

// 把 sink 的脏处点成一句话，写进失败输出的 next。
export function consoleProblems(sink: Sink): string {
  const bad: string[] = [];
  if (sink.errors.length) bad.push(`console.errors ${sink.errors.length} 条`);
  if (sink.pageErrors.length) bad.push(`pageErrors ${sink.pageErrors.length} 条`);
  const sameOrigin = sink.failedRequests.filter((r) => r.sameOrigin);
  if (sameOrigin.length) bad.push(`同源失败请求 ${sameOrigin.length} 条（如 ${sameOrigin[0]?.url}）`);
  return bad.join("；");
}

function cardsNext(missing: string[], sink: Sink): string {
  const hints: string[] = [];
  if (missing.length) {
    hints.push(`缺卡 ${missing.join(", ")}：先查 feature-map 里 selector / alternates 是否还有效；卡该显示却没挂时按 endpoints 注夹具（override --endpoint <端点> --fixture <夹具.json>）`);
  }
  const problems = consoleProblems(sink);
  if (problems) hints.push(`控制台不干净：${problems}，逐条看 console 字段取证`);
  return hints.join("。");
}

function print(payload: unknown, flags: Partial<Flags> = {}) {
  console.log(flags.compact ? JSON.stringify(payload) : JSON.stringify(payload, null, 2));
}

// fail 只抛不调 process.exit：直接 exit 会跳过 try/finally，浏览器关不掉；退出码统一在入口映射。
class ExitError extends Error {
  code: number;
  constructor(code: number) {
    super(`exit ${code}`);
    this.code = code;
  }
}

function fail(message: string, next?: string, code = 1): never {
  print({ ok: false, error: message, next });
  throw new ExitError(code);
}

const HELP = `site-verify — 站点验证共用脚本（lyjwpage-verify）

用法：node scripts/site-verify.ts <子命令> [选项]   输出一律 JSON，--compact 单行。

子命令：
  doctor    检查环境：站点可访问、playwright 可加载、Chrome 能起、本地 Worker 夹具开关
  cards     按 .claude/skills/lyjwpage-verify/feature-map.json 逐张卡片检查存在与可见
  shot      按宽度截图（整页或单卡 clip），同时收集控制台 error / warn / pageerror
  reload    热缓存刷新，查首次绘制后的跳动（字体换装、时间跳、卡片晚到）
  skew      旧页面撞上新部署：用旧 HTML 打开当前站点，查它引用的资源取不取得到、页面有没有样式与水合
  override  夹具注入，转发给 scripts/dev-override.ts（成套注入用 pnpm dev:scene）；--dry-run 只打印命令不执行

公共选项：
  --url <url>         被测站点（默认 http://localhost:3211，或 DEV_SITE_PORT 环境变量）
  --compact           JSON 输出压成单行
  --chrome <path>     Chrome 可执行文件（也可设 SITE_VERIFY_CHROME）

doctor:
  例子  node scripts/site-verify.ts doctor --url http://localhost:3291

cards:
  --card <id[,id]>    只查指定卡片
  --width <px>        视口宽（默认 1280）  --height <px> 视口高（默认 900）
  --theme dark|light  色彩方案（默认 light）
  --settle <ms>       加载后等待毫秒（默认 4000；页面常开 WebSocket，没有 networkidle）
  例子  node scripts/site-verify.ts cards --url http://localhost:3291 --card pulse,vibe-coding

shot:
  --widths <w,w>      宽度列表（默认 1280,375；高度按常用机型取，可用 --height 覆盖）
  --card <id>         只截功能地图里这张卡（元素 clip）
  --viewport          只截视口（默认截整页 fullPage）
  --theme dark|light|both（默认 light）  --dpr <n> 像素密度（默认 1）
  --out <目录>        截图输出目录（必填）  --settle <ms>（默认 4000）
  --ssr               禁用 JavaScript，看 SSR HTML 长什么样
  --engine chromium|webkit  浏览器（默认 chromium；webkit 是 iPhone 的引擎，手机宽度要另截一张，文件名带 -webkit）
  截图藏起开发环境的调试按钮坞与 Vite 报错浮层（报错照样进控制台记录）；多张卡的数据要对得上时先 pnpm dev:scene
  例子  node scripts/site-verify.ts shot --url http://localhost:3291 --widths 1280,375 --out /tmp/shots
        node scripts/site-verify.ts shot --url http://localhost:3291 --widths 375 --engine webkit --out /tmp/shots

reload（热缓存刷新：先加载一次暖缓存，再刷新，查首次绘制之后又变过的文字、画面和字体）：
  --engine chromium|webkit  浏览器（默认 chromium；webkit 要装 Playwright 的 WebKit，只查文字与字体，不录屏）
  --width <px> --height <px>  视口（默认 375x1600：手机宽，高到首页顶部有大图时也录得到下面的卡片）   --theme dark|light（默认 dark）
  --skew <分钟>       浏览器时钟比服务端快几分钟，模拟首屏 HTML 是缓存的旧版（默认 2；0 关掉）
  --latency <ms>      走网络的请求加多少往返延迟，仅 chromium（默认 100；命中缓存的不受影响，每次重新验证的资源会晚到）
  --watch <ms>        刷新后录多久（默认 5000）    --grace <ms> 首次绘制后多久内的变化算流式补齐（默认 100）
  --out <目录>        帧与结果输出目录（必填）
  判据：textJumps 是首次绘制后只变过一两次的文字（时间从快照跳到此刻、水合才补上的内容）；
  frameJumps 是录屏里只变过一两次的画面区域（字体换装、卡片晚到、布局挪动），帧存在 --out；
  fontsAfterPaint 是首帧时还没加载完的字体；liveText / liveRegions 是反复变化的地方（歌词、进度、视频），只列出不判失败。
  例子  node scripts/site-verify.ts reload --url http://localhost:3211 --out /tmp/reload

skew（模拟 Safari 恢复后台标签时按缓存取回的旧 HTML）：
  --old-html <文件>   用这份旧首页 HTML（合并前 curl -s https://lyjw.me/ > 文件 存下）。判据：它引用的 /assets/ 全取得到
                      （R2 存档兜住）、只加载 1 次、有样式、已水合
  不带 --old-html     把当前首页的 JS / CSS 指纹全改成不存在的，判据：自动刷新恰好 1 次后有样式、已水合
  --engine chromium|webkit（默认 chromium）  --width <px> --height <px>（默认 375x812）
  --watch <ms>        打开后等多久再判（默认 8000）   --out <目录>  存一张最后停下的截图（可选）
  例子  node scripts/site-verify.ts skew --url https://lyjw.me --old-html /tmp/old-home.html

override（会改本地 Worker 状态；先 pnpm dev:worker + pnpm dev:local，workers/core/.dev.vars 需 DEV_OVERRIDES=true）：
  --endpoint <路径> --fixture <夹具.json>   注入（夹具名见功能地图 endpoints）
  --endpoint <路径> --clear                 清掉一条注入
  --on | --off                              总开关        --list  列出当前注入（只读）
  --dry-run                                 只打印将执行的 pnpm dev:override 命令
  例子  node scripts/site-verify.ts override --endpoint /api/status/pulse --fixture pulse-busy-day.json --dry-run
`;

export async function resolvePlaywright(): Promise<{ api: PwApi; source: string } | null> {
  const asApi = (mod: unknown, source: string) => {
    const candidate = mod as { chromium?: unknown; default?: { chromium?: unknown } } | null;
    const api = candidate?.chromium ? candidate : (candidate?.default?.chromium ? candidate.default : null);
    return api ? { api: api as PwApi, source } : null;
  };
  if (process.env.SITE_VERIFY_PLAYWRIGHT) {
    return asApi(createRequire(`${ROOT}/x`)(process.env.SITE_VERIFY_PLAYWRIGHT), process.env.SITE_VERIFY_PLAYWRIGHT);
  }
  const bases = [`${ROOT}/`];
  try {
    bases.push(`${execSync("npm root -g", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim()}/`);
  } catch {}
  bases.push("/opt/node22/lib/node_modules/");
  for (const base of bases) {
    for (const pkg of ["playwright", "playwright-core"]) {
      try {
        const found = asApi(createRequire(base)(pkg), `${base}${pkg}`);
        if (found) return found;
      } catch {}
    }
  }
  if (fs.existsSync(RENDER_PLAYWRIGHT)) {
    return asApi(await import(pathToFileURL(RENDER_PLAYWRIGHT).href), RENDER_PLAYWRIGHT);
  }
  return null;
}

// 开发环境才有的调试按钮坞（src/components/dev-toggles.tsx#DevToggleDock）与 Vite 报错浮层不进截图，免得被当成站点界面。
export const HIDE_DEV_UI = "#dev-toggles, vite-error-overlay { display: none !important; }";

const PLAYWRIGHT_NEXT = "仓库自带 playwright-core 在 docs/explainer/render，先跑 `pnpm --dir docs/explainer/render install --ignore-workspace`；云端容器通常已全局安装。";
const WEBKIT_NEXT = "装 Playwright 的 WebKit：playwright install --with-deps webkit（版本要和 doctor 解到的 playwright 一致；装进 PLAYWRIGHT_BROWSERS_PATH 指的目录）";

export async function launchBrowser(pw: PwApi, flags: Partial<Flags> = {}): Promise<{ browser: PwBrowser; via: Record<string, string> }> {
  const explicit = stringFlag(flags.chrome) || process.env.SITE_VERIFY_CHROME;
  const attempts: Record<string, string>[] = explicit
    ? [{ executablePath: explicit }]
    : [{ channel: "chrome" }, { executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" }, {}];
  let lastError: unknown;
  for (const opts of attempts) {
    try {
      return { browser: await pw.chromium.launch({ headless: true, ...opts }), via: opts };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function launchEngine(pw: PwApi, flags: Partial<Flags>): Promise<{ browser: PwBrowser; via: Record<string, string> }> {
  if (flags.engine !== "webkit") return launchBrowser(pw, flags);
  return { browser: await pw.webkit.launch({ headless: true }), via: { engine: "webkit" } };
}

function watchConsole(page: PwPage, sink: Sink, current: { origin: string | null }) {
  const push = (list: string[], text: string) => {
    if (!list.includes(text)) list.push(text);
  };
  // 同源判定跟当前页面走：跳转换域后，新域的第一方失败也要计入。
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) updateOrigin(current, frame.url());
  });
  page.on("console", (msg) => {
    const text = msg.text();
    if (isEnvNoise(text)) return push(sink.envNoise, text);
    // 「Failed to load resource」不带 URL，具体哪条失败由下面的 response 监听记。
    if (/Failed to load resource/.test(text)) return;
    if (msg.type() === "error") push(sink.errors, text);
    else if (msg.type() === "warning") push(sink.warnings, text);
  });
  page.on("pageerror", (error) => push(sink.pageErrors, String(error)));
  page.on("response", (response) => {
    if (response.status() < 400) return;
    const url = response.url();
    const kind = classifyRequest(url, response.status(), current.origin);
    if (kind === "noise") {
      return push(sink.envNoise, `${response.request().method()} ${new URL(url).pathname} → ${response.status()}`);
    }
    sink.failedRequests.push({ url, status: response.status(), sameOrigin: kind === "same-origin" });
  });
  // 连接被拒 / DNS / 超时等连响应都没有的失败只走 requestfailed；4xx/5xx 归上面 response。
  page.on("requestfailed", (request) => {
    const url = request.url();
    const kind = classifyRequest(url, null, current.origin);
    if (kind === "noise") {
      return push(sink.envNoise, `${request.method()} ${new URL(url).pathname || url} → ${request.failure()?.errorText ?? "failed"}`);
    }
    sink.failedRequests.push({
      url,
      status: null,
      error: request.failure()?.errorText ?? "unknown",
      sameOrigin: kind === "same-origin",
    });
  });
}

async function openPage(pwApi: PwApi, flags: Flags, { width, height }: Viewport, sink: Sink) {
  const { browser, via } = await launchEngine(pwApi, flags);
  try {
    const context = await browser.newContext({
      viewport: { width, height },
      colorScheme: flags.theme === "dark" ? "dark" : "light",
      deviceScaleFactor: Number(flags.dpr || 1),
      javaScriptEnabled: flags.ssr !== true,
    });
    const page = await context.newPage();
    watchConsole(page, sink, { origin: navOrigin(flags.url) });
    await page.goto(flags.url, { waitUntil: "load", timeout: 60_000 });
    return { browser, page, via };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

// 屏外卡片用 content-visibility 延迟布局，先滚一遍再量。
const SCROLL_SWEEP = `(async () => {
  for (let y = 0; y < document.body.scrollHeight + 1200; y += 600) {
    scrollTo(0, y);
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  scrollTo(0, 0);
})()`;

async function scrollSweep(page: PwPage) {
  await page.evaluate(SCROLL_SWEEP);
  await page.waitForTimeout(300);
}

const FIND_EL = `(spec) => {
  let el = null;
  for (const selector of [spec.selector, ...(spec.alternates ?? [])].filter(Boolean)) {
    el = document.querySelector(selector);
    if (el) break;
  }
  if (!el && spec.cardLabel) {
    el = [...document.querySelectorAll(".paper-card")].find((card) => {
      const label = card.querySelector(".label-mono");
      return label && label.textContent.trim() === spec.cardLabel;
    });
  }
  return el;
}`;

const LOCATE_FN = `(spec) => {
  const el = (${FIND_EL})(spec);
  if (!el) return null;
  const box = el.getBoundingClientRect();
  const style = getComputedStyle(el);
  const covered = !!el.closest("[aria-hidden='true'],[inert],[hidden]");
  const visible = box.width > 0 && box.height > 0 && style.visibility !== "hidden" && Number(style.opacity) > 0 && !covered;
  return { visible, box: { x: box.x, y: box.y, width: box.width, height: box.height } };
}`;

async function locate(page: PwPage, spec: CardSpec): Promise<Located> {
  return page.evaluate(`(${LOCATE_FN})(${JSON.stringify(spec)})`) as Promise<Located>;
}

async function locateHandle(page: PwPage, spec: CardSpec) {
  const handle = await page.evaluateHandle(`(${FIND_EL})(${JSON.stringify(spec)})`);
  return handle.asElement();
}

function cardSpec(id: string, entry: CardEntry): CardSpec {
  return { id, selector: entry.selector, alternates: entry.alternates, cardLabel: entry.cardLabel };
}

async function cmdDoctor(flags: Flags) {
  const checks: { name: string; status: string; detail: unknown; next?: string }[] = [];
  const add = (name: string, status: string, detail: unknown, next?: string) => checks.push({ name, status, detail, ...(next ? { next } : {}) });

  try {
    const response = await fetch(`${flags.url}/api/version`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = (await response.json()) as { commit?: string } | null;
    add("site", "pass", { url: flags.url, commit: body?.commit ?? null });
  } catch (error) {
    add("site", "fail", errorText(error), "先起服务：DEV_SITE_PORT=<端口> pnpm dev（连生产 Worker）；要整套本地 Worker 用 pnpm dev:worker + pnpm dev:local。本脚本不负责起停。");
  }

  const pw = await resolvePlaywright().catch(() => null);
  add("playwright", pw ? "pass" : "fail", pw ? { source: pw.source } : "解不到 playwright / playwright-core", pw ? undefined : PLAYWRIGHT_NEXT);

  if (pw) {
    try {
      const { browser, via } = await launchBrowser(pw.api, flags);
      try {
        add("chrome", "pass", { via, version: browser.version() });
      } finally {
        await browser.close();
      }
    } catch (error) {
      add("chrome", "fail", errorText(error).slice(0, 300), "装 Google Chrome（playwright-core 用 channel chrome），或 `--chrome <路径>` / SITE_VERIFY_CHROME 指定可执行文件。");
    }
  } else {
    add("chrome", "fail", "跳过：playwright 没解到", PLAYWRIGHT_NEXT);
  }

  try {
    const response = await fetch(`${WORKER_URL}/api/dev/overrides`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    add("dev-worker", "pass", { url: WORKER_URL, ...((await response.json()) as object) });
  } catch (error) {
    add("dev-worker", "warn", `本地 Worker 不可达（${errorText(error).slice(0, 120)}）`, "要注入夹具先 pnpm dev:worker + pnpm dev:local，且 workers/core/.dev.vars 有 DEV_OVERRIDES=true；只验生产数据可忽略此项。");
  }

  const map = loadFeatureMap();
  if (!map) add("feature-map", "fail", `读不到 ${path.relative(ROOT, MAP_PATH)}`);
  else {
    const missing: string[] = [];
    for (const entry of Object.values(map.cards)) {
      if (!fs.existsSync(path.join(ROOT, entry.component))) missing.push(entry.component);
      for (const list of Object.values(entry.endpoints ?? {})) {
        for (const f of list) if (!fs.existsSync(path.join(ROOT, "workers/core/dev-fixtures", f))) missing.push(f);
      }
    }
    add("feature-map", missing.length ? "fail" : "pass", { cards: Object.keys(map.cards).length, missing });
  }

  const ok = checks.every((c) => c.status !== "fail");
  print({ ok, checks }, flags);
  if (!ok) process.exitCode = 1;
}

async function cmdCards(flags: Flags) {
  const map = loadFeatureMap() ?? fail(`读不到功能地图 ${path.relative(ROOT, MAP_PATH)}`, "先确认在仓库根目录跑");
  const wanted = flags.card ? String(flags.card).split(",").map((s) => s.trim()) : Object.keys(map.cards);
  const unknown = wanted.filter((id) => !map.cards[id]);
  if (unknown.length) fail(`未知卡片 id：${unknown.join(", ")}`, `可选：${Object.keys(map.cards).join(", ")}`, 2);

  if (flags.ssr) fail("cards 靠页面内 evaluate 定位卡片，--ssr 禁了 JavaScript", "看 SSR 用 shot --ssr 截整页，或 curl -sS <url> 看 HTML", 2);
  const pw = await resolvePlaywright() ?? fail("解不到 playwright / playwright-core", PLAYWRIGHT_NEXT);
  const viewport = { width: Number(flags.width || 1280), height: Number(flags.height || 900) };
  const sink = newSink();
  const { browser, page } = await openPage(pw.api, flags, viewport, sink);
  try {
    await page.waitForTimeout(Number(flags.settle || 4000));
    await scrollSweep(page);
    const cards: Record<string, { status: string; box?: Box; note?: string; proves: unknown }> = {};
    for (const id of wanted) {
      const entry = map.cards[id] as CardEntry;
      const found = await locate(page, cardSpec(id, entry));
      const status = !found ? "absent" : found.visible ? "visible" : "hidden";
      cards[id] = {
        status,
        ...(found?.box ? { box: found.box } : {}),
        ...(entry.conditional && status !== "visible"
          ? { note: flags.card ? "conditional 卡片，但 --card 点名了就期望它出现：缺失算失败；要看用 override 注夹具" : "conditional 卡片，当前数据下不显示是正常；要看用 override 注夹具" }
          : {}),
        proves: entry.proves,
      };
    }
    const required = requiredCardIds(map, wanted, Boolean(flags.card));
    const missingRequired = required.filter((id) => cards[id]?.status !== "visible");
    const ok = missingRequired.length === 0 && consoleClean(sink);
    print({ ok, ...(ok ? {} : { next: cardsNext(missingRequired, sink) }), url: flags.url, viewport, cards, console: sink }, flags);
    if (!ok) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

async function cmdShot(flags: Flags) {
  const out = stringFlag(flags.out) ?? fail("shot 需要 --out <目录>", "例子：shot --url http://localhost:3291 --widths 1280,375 --out /tmp/shots", 2);
  const map = loadFeatureMap();
  if (flags.card === true) fail("--card 后面缺卡片 id", `可选：${map ? Object.keys(map.cards).join(", ") : "功能地图读不到"}`, 2);
  const card = stringFlag(flags.card);
  const cardEntry = card ? map?.cards?.[card] : null;
  if (card && !cardEntry) fail(`未知卡片 id：${card}`, `可选：${map ? Object.keys(map.cards).join(", ") : "功能地图读不到"}`, 2);
  const viewports = parseWidths(flags.widths) ?? fail("--widths 格式如 1280,375", undefined, 2);
  if (flags.height) for (const v of viewports) v.height = Number(flags.height);
  const themes = flags.theme === "both" ? ["light", "dark"] : [flags.theme === "dark" ? "dark" : "light"];
  fs.mkdirSync(out, { recursive: true });

  const pw = await resolvePlaywright() ?? fail("解不到 playwright / playwright-core", PLAYWRIGHT_NEXT);
  const engine = flags.engine === "webkit" ? "webkit" : "chromium";
  if (engine === "webkit") {
    const probe = await launchEngine(pw.api, flags).catch((error: unknown) => fail(`起不来 webkit：${errorText(error).slice(0, 200)}`, WEBKIT_NEXT));
    await probe.browser.close();
  }
  const shots: ({ file: string | null; card: string | null; theme: string; error?: string; console: Sink } & Viewport)[] = [];
  let failed = false;
  for (const theme of themes) {
    for (const viewport of viewports) {
      const sink = newSink();
      const runFlags: Flags = { ...flags, theme };
      const name = `${card ?? "page"}-${viewport.width}x${viewport.height}-${theme}${engine === "webkit" ? "-webkit" : ""}${runFlags.ssr ? "-ssr" : ""}.png`;
      const file = path.join(out, name);
      // 先删同名旧图：这次失败时目录里不留上一轮产物冒充本轮证据。
      fs.rmSync(file, { force: true });
      let browser: PwBrowser | undefined;
      try {
        const session = await openPage(pw.api, runFlags, viewport, sink);
        browser = session.browser;
        const { page } = session;
        if (!runFlags.ssr) await page.addStyleTag({ content: HIDE_DEV_UI });
        await page.waitForTimeout(Number(flags.settle || 4000));
        if (!runFlags.ssr) await scrollSweep(page);
        if (card && runFlags.ssr) {
          shots.push({ file: null, card, ...viewport, theme, error: "--ssr 禁了 JavaScript，不能定位卡片；要 SSR 截图截整页", console: sink });
          failed = true;
          continue;
        }
        if (card && cardEntry) {
          const spec = cardSpec(card, cardEntry);
          const found = await locate(page, spec);
          const el = found?.visible ? await locateHandle(page, spec) : null;
          if (!el) {
            shots.push({ file: null, card, ...viewport, theme, error: "卡片在当前数据下不显示", console: sink });
            failed = true;
            continue;
          }
          await el.scrollIntoViewIfNeeded();
          await page.waitForTimeout(200);
          await el.screenshot({ path: file });
        } else {
          await page.screenshot({ path: file, fullPage: flags.viewport !== true });
        }
        shots.push({ file, card: card ?? null, ...viewport, theme, console: sink });
      } catch (error) {
        failed = true;
        shots.push({ file: null, card: card ?? null, ...viewport, theme, error: errorText(error), console: sink });
      } finally {
        await browser?.close();
      }
    }
  }
  const ok = !failed && shots.every((s) => s.file && consoleClean(s.console));
  // !ok 时 problems 必非空：failed 只跟着 problems 类条目出现，every 不过也必有脏 shot。
  const next = ok
    ? undefined
    : shots
        .filter((s) => !s.file || !consoleClean(s.console))
        .map((s) => `${s.card ?? "page"}-${s.width}x${s.height}-${s.theme}：${s.error ?? `控制台不干净（${consoleProblems(s.console)}）`}`)
        .join("；");
  print({ ok, ...(next ? { next } : {}), engine, out: path.resolve(out), shots }, flags);
  if (!ok) process.exitCode = 1;
}

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

export function staleAssetHtml(html: string): string {
  return html.replace(/(\/assets\/[A-Za-z0-9_.-]+?)-[A-Za-z0-9_-]{8}\.(js|css)\b/g, "$1-SKEW0000.$2");
}

export function documentCommit(html: string): string | null {
  return /<meta name="build-commit" content="([^"]*)"/.exec(html)?.[1] ?? null;
}

export function skewVerdict({ mode, documents, assetFailures, styled, hydrated }: { mode: string; documents: number; assetFailures: unknown[]; styled: boolean; hydrated: boolean }): string[] {
  const problems: string[] = [];
  if (!styled) problems.push("最后停下的页面样式表没挂上（整屏大图那种）");
  if (!hydrated) problems.push("最后停下的页面没水合（点不动）");
  if (mode === "archive") {
    if (assetFailures.length) problems.push(`旧 HTML 引用的 ${assetFailures.length} 个文件取不到：R2 存档里没有，看这次构建日志里的 [asset-archive] 行`);
    if (documents > 1) problems.push("页面是靠自动刷新才恢复的，存档没兜住");
  } else if (documents !== 2) {
    problems.push(`文档加载了 ${documents} 次，自动刷新应当恰好 1 次（共 2 次）`);
  }
  return problems;
}

const SKEW_STATE = `(() => {
  const own = (href) => { try { const u = new URL(href, location.href); return u.origin === location.origin && u.pathname.startsWith("/assets/"); } catch { return false; } };
  const rules = (link) => { try { return link.sheet ? link.sheet.cssRules.length : 0; } catch { return 0; } };
  const sheets = [...document.querySelectorAll('link[rel="stylesheet"]')].filter((link) => own(link.href));
  return {
    buildCommit: document.querySelector('meta[name="build-commit"]')?.getAttribute("content") ?? null,
    styled: sheets.length > 0 && sheets.every((link) => rules(link) > 0),
    hydrated: Object.keys(document.body).some((key) => key.startsWith("__react")),
  };
})()`;

async function cmdSkew(flags: Flags) {
  const engine = flags.engine === "webkit" ? "webkit" : "chromium";
  const oldHtmlPath = typeof flags["old-html"] === "string" ? flags["old-html"] : null;
  if (oldHtmlPath && !fs.existsSync(oldHtmlPath)) fail(`没有 ${oldHtmlPath}`, "合并前先存一份：curl -s https://lyjw.me/ > <文件>", 2);
  const oldHtml = oldHtmlPath ? fs.readFileSync(oldHtmlPath, "utf8") : null;
  const mode = oldHtml ? "archive" : "recover";
  const viewport = { width: Number(flags.width || 375), height: Number(flags.height || 812) };
  const watch = Number(flags.watch || 8000);
  const target = new URL(`${flags.url}/`);

  const pw = await resolvePlaywright() ?? fail("解不到 playwright / playwright-core", PLAYWRIGHT_NEXT);
  const sink = newSink();
  let browser: PwBrowser;
  try {
    browser = (await launchEngine(pw.api, flags)).browser;
  } catch (error) {
    fail(`起不来 ${engine}：${errorText(error).slice(0, 200)}`, engine === "webkit" ? WEBKIT_NEXT : "同 doctor 的 chrome 项");
  }
  try {
    const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
    const page = await context.newPage();
    watchConsole(page, sink, { origin: target.origin });
    const documents: string[] = [];
    const assetFailures: { url: string; status?: number; error?: string }[] = [];
    page.on("request", (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) documents.push(request.url());
    });
    const isOwnAsset = (url: string) => {
      const parsed = new URL(url);
      return parsed.origin === target.origin && parsed.pathname.startsWith("/assets/");
    };
    page.on("response", (response) => {
      if (response.status() >= 400 && isOwnAsset(response.url())) assetFailures.push({ url: response.url(), status: response.status() });
    });
    page.on("requestfailed", (request) => {
      if (isOwnAsset(request.url())) assetFailures.push({ url: request.url(), error: request.failure()?.errorText ?? "failed" });
    });
    let staleCommit = oldHtml ? documentCommit(oldHtml) : null;
    let served = false;
    await page.route((url) => url.origin === target.origin && url.pathname === target.pathname, async (route) => {
      if (served || route.request().resourceType() !== "document") return route.continue();
      served = true;
      if (oldHtml) return route.fulfill({ status: 200, contentType: "text/html; charset=utf-8", body: oldHtml });
      const response = await route.fetch();
      const body = await response.text();
      staleCommit = documentCommit(body);
      return route.fulfill({ response, body: staleAssetHtml(body) });
    });
    await page.goto(target.href, { waitUntil: "load", timeout: 60_000 });
    await page.waitForTimeout(watch);
    const state = (await page.evaluate(SKEW_STATE)) as { buildCommit: string | null; styled: boolean; hydrated: boolean };
    const out = stringFlag(flags.out);
    if (out) {
      fs.mkdirSync(out, { recursive: true });
      await page.screenshot({ path: path.join(out, `skew-${engine}-${mode}.png`) });
    }
    const problems = skewVerdict({ mode, documents: documents.length, assetFailures, ...state });
    const ok = problems.length === 0;
    print({
      ok,
      ...(ok ? {} : { next: problems.join("；") }),
      engine,
      mode,
      staleCommit,
      finalCommit: state.buildCommit,
      documentLoads: documents.length,
      assetFailures,
      styled: state.styled,
      hydrated: state.hydrated,
      ...(out ? { out: path.resolve(out) } : {}),
      console: sink,
    }, flags);
    if (!ok) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

async function cmdReload(flags: Flags) {
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
    browser = (await launchEngine(pw.api, flags)).browser;
  } catch (error) {
    fail(`起不来 ${engine}：${errorText(error).slice(0, 200)}`, engine === "webkit" ? WEBKIT_NEXT : "同 doctor 的 chrome 项");
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

function cmdOverride(flags: Flags) {
  const argv: string[] = [];
  if (flags.list) argv.push("--list");
  else if (flags.on || flags.off) argv.push(flags.on ? "--on" : "--off");
  else if (flags.endpoint && flags.clear) argv.push(String(flags.endpoint), "--clear");
  else if (flags.endpoint && flags.fixture) argv.push(String(flags.endpoint), String(flags.fixture));
  else {
    fail(
      "override 参数不全",
      "要 --endpoint <路径> --fixture <夹具.json>，或 --endpoint <路径> --clear，或 --on/--off/--list。夹具名见功能地图 endpoints。",
      2,
    );
  }
  const command = `pnpm dev:override ${argv.join(" ")}`;
  if (flags["dry-run"]) {
    print({ ok: true, dryRun: true, command, workerUrl: WORKER_URL, next: "去掉 --dry-run 执行；前提是本地 Worker 在跑且 DEV_OVERRIDES=true" }, flags);
    return;
  }
  const result = spawnSync("node", [DEV_OVERRIDE, ...argv], {
    cwd: ROOT,
    env: { ...process.env, DEV_WORKER_URL: WORKER_URL },
    encoding: "utf8",
  });
  const ok = result.status === 0;
  print(
    {
      ok,
      command,
      workerUrl: WORKER_URL,
      exitCode: result.status,
      stdout: result.stdout?.trim() ?? "",
      ...(result.stderr?.trim() ? { stderr: result.stderr.trim() } : {}),
      ...(ok ? {} : { next: "本地 Worker 要在跑（pnpm dev:worker + pnpm dev:local），且 workers/core/.dev.vars 里 DEV_OVERRIDES=true" }),
    },
    flags,
  );
  if (!ok) process.exitCode = result.status || 1;
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  const command = parsed.positional[0] ?? (parsed.flags.help ? "help" : null);
  const flags: Flags = { ...parsed.flags, url: String(parsed.flags.url || DEFAULT_URL).replace(/\/+$/, "") };
  if (!command || command === "help" || flags.help === true) {
    process.stdout.write(HELP);
    if (!command && !flags.help) process.exitCode = 2;
    return;
  }
  if (command === "doctor") return cmdDoctor(flags);
  if (command === "cards") return cmdCards(flags);
  if (command === "shot") return cmdShot(flags);
  if (command === "override") return cmdOverride(flags);
  if (command === "reload") return cmdReload(flags);
  if (command === "skew") return cmdSkew(flags);
  fail(`未知子命令：${command}`, "可用：doctor / cards / shot / reload / skew / override；--help 看全部选项", 2);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((caught: unknown) => {
    let error = caught;
    if (!(error instanceof ExitError)) {
      print({ ok: false, error: errorText(error), next: "带 --help 看用法；疑似 bug 时把这条错误贴回主线程" });
      error = new ExitError(1);
    }
    process.exitCode = (error as ExitError).code;
  });
}
