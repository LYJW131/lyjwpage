import fs from "node:fs";
import path from "node:path";

import { launchBrowser, PLAYWRIGHT_NEXT, resolvePlaywright, watchConsole, type PwBrowser } from "./browser.ts";
import { errorText, fail, print, stringFlag, type Flags } from "./cli.ts";
import { newSink } from "./console-sink.ts";

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

export async function cmdSkew(flags: Flags) {
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
    browser = engine === "webkit" ? await pw.api.webkit.launch({ headless: true }) : (await launchBrowser(pw.api, flags)).browser;
  } catch (error) {
    fail(`起不来 ${engine}：${errorText(error).slice(0, 200)}`, engine === "webkit" ? "WebKit 要 Playwright 自带的构建：npx playwright install webkit，或 PLAYWRIGHT_BROWSERS_PATH 指向已装的目录" : "同 doctor 的 chrome 项");
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
