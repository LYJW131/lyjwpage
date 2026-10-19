import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

import { ROOT, stringFlag, type Box, type Flags, type Viewport } from "./cli.ts";
import { classifyRequest, isEnvNoise, navOrigin, updateOrigin, type Sink } from "./console-sink.ts";

const RENDER_PLAYWRIGHT = path.join(ROOT, "docs", "explainer", "render", "node_modules", "playwright-core", "index.mjs");

export type CardSpec = { id: string; selector?: string; alternates?: string[]; cardLabel?: string };
type Located = { visible: boolean; box: Box } | null;

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
export type PwPage = {
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
export type PwBrowser = {
  newContext(options: Record<string, unknown>): Promise<PwContext>;
  version(): string;
  close(): Promise<void>;
};
type PwBrowserType = { launch(options: Record<string, unknown>): Promise<PwBrowser> };
export type PwApi = { chromium: PwBrowserType; webkit: PwBrowserType };

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

export const PLAYWRIGHT_NEXT = "仓库自带 playwright-core 在 docs/explainer/render，先跑 `pnpm --dir docs/explainer/render install --ignore-workspace`；云端容器通常已全局安装。";
export const WEBKIT_NEXT = "装 Playwright 的 WebKit：playwright install --with-deps webkit（版本要和 doctor 解到的 playwright 一致；装进 PLAYWRIGHT_BROWSERS_PATH 指的目录）";

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

export async function launchEngine(pw: PwApi, flags: Partial<Flags>): Promise<{ browser: PwBrowser; via: Record<string, string> }> {
  if (flags.engine !== "webkit") return launchBrowser(pw, flags);
  return { browser: await pw.webkit.launch({ headless: true }), via: { engine: "webkit" } };
}

export function watchConsole(page: PwPage, sink: Sink, current: { origin: string | null }) {
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

export async function openPage(pwApi: PwApi, flags: Flags, { width, height }: Viewport, sink: Sink) {
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

export async function scrollSweep(page: PwPage) {
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

export async function locate(page: PwPage, spec: CardSpec): Promise<Located> {
  return page.evaluate(`(${LOCATE_FN})(${JSON.stringify(spec)})`) as Promise<Located>;
}

export async function locateHandle(page: PwPage, spec: CardSpec) {
  const handle = await page.evaluateHandle(`(${FIND_EL})(${JSON.stringify(spec)})`);
  return handle.asElement();
}
