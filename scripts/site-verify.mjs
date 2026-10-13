#!/usr/bin/env node
import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(import.meta.dirname, "..");
const MAP_PATH = path.join(ROOT, ".claude", "skills", "lyjwpage-verify", "feature-map.json");
const DEV_OVERRIDE = path.join(ROOT, "scripts", "dev-override.mjs");
const RENDER_PLAYWRIGHT = path.join(ROOT, "docs", "explainer", "render", "node_modules", "playwright-core", "index.mjs");

const DEFAULT_URL = `http://localhost:${process.env.DEV_SITE_PORT || "3211"}`;
const WORKER_URL = (process.env.DEV_WORKER_URL || "http://localhost:8788").replace(/\/+$/, "");
const HEIGHT_BY_WIDTH = { 375: 812, 768: 1024, 820: 1180, 1024: 768, 1280: 900, 1440: 900 };
// 环境噪声不是站点错误（SKILL.md 约定）：容器代理把 WebSocket 升级挡成 426，消息里必须同时有 426 才豁免；
// Vite dev 重优化依赖时偶发 504。其它 ws 失败（鉴权、路由、5xx）照常算。
const ENV_NOISE = [
  /WebSocket connection to '\w+:\/\/[^']*\/ws[^']*' failed.*\b426\b/i,
  /Outdated Optimize Dep/,
];

export function isEnvNoise(text) {
  return ENV_NOISE.some((pattern) => pattern.test(text));
}

export function parseArgs(argv) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    if (eq !== -1) {
      flags[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
      flags[arg.slice(2)] = argv[i + 1];
      i += 1;
    } else {
      flags[arg.slice(2)] = true;
    }
  }
  return { flags, positional };
}

export function parseWidths(value) {
  const list = String(value ?? "1280,375").split(",").map((w) => Number(w.trim()));
  if (list.some((w) => !Number.isInteger(w) || w < 200 || w > 4000)) return null;
  return list.map((width) => ({ width, height: HEIGHT_BY_WIDTH[width] ?? 900 }));
}

export function loadFeatureMap(mapPath = MAP_PATH) {
  if (!fs.existsSync(mapPath)) return null;
  return JSON.parse(fs.readFileSync(mapPath, "utf8"));
}

// 归一化「这条控制台面干不干净」：cards 与 shot 同一份判据，envNoise 不算。
export function consoleClean(sink) {
  return (
    sink.errors.length === 0 &&
    sink.pageErrors.length === 0 &&
    !sink.failedRequests.some((request) => request.sameOrigin)
  );
}

export function newSink() {
  return { errors: [], warnings: [], pageErrors: [], envNoise: [], failedRequests: [] };
}

// 返回 "noise" | "same-origin" | "external"。noise 只放确定的环境原因：/favicon.ico 是浏览器自动探测
// （站点图标在 /icon，生产同样 404）；WebSocket 升级只豁免容器代理回的 426，requestfailed 没有状态码、
// 其它 ws 失败（鉴权 4xx、路由、5xx、断网）一律按源分类，同源计入失败。
export function classifyRequest(url, status, origin) {
  const parsed = new URL(url);
  if (parsed.pathname === "/favicon.ico") return "noise";
  const isWebSocket = parsed.protocol === "ws:" || parsed.protocol === "wss:";
  if ((isWebSocket || parsed.pathname === "/ws") && status === 426) return "noise";
  // ws(s): 的 origin 是 ws 方案、和 http(s) origin 比不等；同站 ws 按 host 相等判。
  const sameOrigin = isWebSocket ? parsed.host === new URL(origin).host : parsed.origin === origin;
  return sameOrigin ? "same-origin" : "external";
}

// --card 显式点名就是期望它出现：conditional 卡被点名时也算 required。
export function requiredCardIds(map, wanted, explicit) {
  return explicit ? wanted : wanted.filter((id) => !map.cards[id].conditional);
}

function print(payload, flags = {}) {
  console.log(flags.compact ? JSON.stringify(payload) : JSON.stringify(payload, null, 2));
}

function fail(message, next, code = 1) {
  print({ ok: false, error: message, next });
  process.exit(code);
}

const HELP = `site-verify — 站点验证共用脚本（lyjwpage-verify）

用法：node scripts/site-verify.mjs <子命令> [选项]   输出一律 JSON，--compact 单行。

子命令：
  doctor    检查环境：站点可访问、playwright 可加载、Chrome 能起、本地 Worker 夹具开关
  cards     按 .claude/skills/lyjwpage-verify/feature-map.json 逐张卡片检查存在与可见
  shot      按宽度截图（整页或单卡 clip），同时收集控制台 error / warn / pageerror
  override  夹具注入，转发给 scripts/dev-override.mjs；--dry-run 只打印命令不执行

公共选项：
  --url <url>         被测站点（默认 http://localhost:3211，或 DEV_SITE_PORT 环境变量）
  --compact           JSON 输出压成单行
  --chrome <path>     Chrome 可执行文件（也可设 SITE_VERIFY_CHROME）

doctor:
  例子  node scripts/site-verify.mjs doctor --url http://localhost:3291

cards:
  --card <id[,id]>    只查指定卡片
  --width <px>        视口宽（默认 1280）  --height <px> 视口高（默认 900）
  --theme dark|light  色彩方案（默认 light）
  --settle <ms>       加载后等待毫秒（默认 4000；页面常开 WebSocket，没有 networkidle）
  例子  node scripts/site-verify.mjs cards --url http://localhost:3291 --card pulse,vibe-coding

shot:
  --widths <w,w>      宽度列表（默认 1280,375；高度按常用机型取，可用 --height 覆盖）
  --card <id>         只截功能地图里这张卡（元素 clip）
  --viewport          只截视口（默认截整页 fullPage）
  --theme dark|light|both（默认 light）  --dpr <n> 像素密度（默认 1）
  --out <目录>        截图输出目录（必填）  --settle <ms>（默认 4000）
  --ssr               禁用 JavaScript，看 SSR HTML 长什么样
  例子  node scripts/site-verify.mjs shot --url http://localhost:3291 --widths 1280,375 --out /tmp/shots

override（会改本地 Worker 状态；先 pnpm dev:worker + pnpm dev:local，workers/core/.dev.vars 需 DEV_OVERRIDES=true）：
  --endpoint <路径> --fixture <夹具.json>   注入（夹具名见功能地图 endpoints）
  --endpoint <路径> --clear                 清掉一条注入
  --on | --off                              总开关        --list  列出当前注入（只读）
  --dry-run                                 只打印将执行的 pnpm dev:override 命令
  例子  node scripts/site-verify.mjs override --endpoint /api/status/pulse --fixture pulse-busy-day.json --dry-run
`;

async function resolvePlaywright() {
  const asApi = (mod, source) => {
    const api = mod?.chromium ? mod : (mod?.default?.chromium ? mod.default : null);
    return api ? { api, source } : null;
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

const PLAYWRIGHT_NEXT = "仓库自带 playwright-core 在 docs/explainer/render，先跑 `pnpm --dir docs/explainer/render install --ignore-workspace`；云端容器通常已全局安装。";

async function launchBrowser(pw, flags = {}) {
  const explicit = flags.chrome || process.env.SITE_VERIFY_CHROME;
  const attempts = explicit
    ? [{ executablePath: explicit }]
    : [{ channel: "chrome" }, { executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" }, {}];
  let lastError;
  for (const opts of attempts) {
    try {
      return { browser: await pw.chromium.launch({ headless: true, ...opts }), via: opts };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function watchConsole(page, sink, origin) {
  const push = (list, text) => {
    if (!list.includes(text)) list.push(text);
  };
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
    if (classifyRequest(url, response.status(), origin) === "noise") {
      return push(sink.envNoise, `${response.request().method()} ${new URL(url).pathname} → ${response.status()}`);
    }
    sink.failedRequests.push({ url, status: response.status(), sameOrigin: new URL(url).origin === origin });
  });
  // 连接被拒 / DNS / 超时等连响应都没有的失败只走 requestfailed；4xx/5xx 归上面 response。
  page.on("requestfailed", (request) => {
    const url = request.url();
    const kind = classifyRequest(url, null, origin);
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

async function openPage(pwApi, flags, { width, height }, sink) {
  const { browser, via } = await launchBrowser(pwApi, flags);
  const context = await browser.newContext({
    viewport: { width, height },
    colorScheme: flags.theme === "dark" ? "dark" : "light",
    deviceScaleFactor: Number(flags.dpr || 1),
    javaScriptEnabled: flags.ssr !== true,
  });
  const page = await context.newPage();
  watchConsole(page, sink, new URL(flags.url).origin);
  await page.goto(flags.url, { waitUntil: "load", timeout: 60_000 });
  return { browser, page, via };
}

// 屏外卡片用 content-visibility 延迟布局，先滚一遍再量。
const SCROLL_SWEEP = `(async () => {
  for (let y = 0; y < document.body.scrollHeight + 1200; y += 600) {
    scrollTo(0, y);
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  scrollTo(0, 0);
})()`;

async function scrollSweep(page) {
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

async function locate(page, spec) {
  return page.evaluate(`(${LOCATE_FN})(${JSON.stringify(spec)})`);
}

async function locateHandle(page, spec) {
  const handle = await page.evaluateHandle(`(${FIND_EL})(${JSON.stringify(spec)})`);
  return handle.asElement();
}

function cardSpec(id, entry) {
  return { id, selector: entry.selector, alternates: entry.alternates, cardLabel: entry.cardLabel };
}

async function cmdDoctor(flags) {
  const checks = [];
  const add = (name, status, detail, next) => checks.push({ name, status, detail, ...(next ? { next } : {}) });

  try {
    const response = await fetch(`${flags.url}/api/version`, { signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json();
    add("site", "pass", { url: flags.url, commit: body?.commit ?? null });
  } catch (error) {
    add("site", "fail", String(error?.message ?? error), "先起服务：DEV_SITE_PORT=<端口> pnpm dev（连生产 Worker）；要整套本地 Worker 用 pnpm dev:worker + pnpm dev:local。本脚本不负责起停。");
  }

  const pw = await resolvePlaywright().catch(() => null);
  add("playwright", pw ? "pass" : "fail", pw ? { source: pw.source } : "解不到 playwright / playwright-core", pw ? undefined : PLAYWRIGHT_NEXT);

  if (pw) {
    try {
      const { browser, via } = await launchBrowser(pw.api, flags);
      add("chrome", "pass", { via, version: browser.version() });
      await browser.close();
    } catch (error) {
      add("chrome", "fail", String(error?.message ?? error).slice(0, 300), "装 Google Chrome（playwright-core 用 channel chrome），或 `--chrome <路径>` / SITE_VERIFY_CHROME 指定可执行文件。");
    }
  } else {
    add("chrome", "fail", "跳过：playwright 没解到", PLAYWRIGHT_NEXT);
  }

  try {
    const response = await fetch(`${WORKER_URL}/api/dev/overrides`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    add("dev-worker", "pass", { url: WORKER_URL, ...(await response.json()) });
  } catch (error) {
    add("dev-worker", "warn", `本地 Worker 不可达（${String(error?.message ?? error).slice(0, 120)}）`, "要注入夹具先 pnpm dev:worker + pnpm dev:local，且 workers/core/.dev.vars 有 DEV_OVERRIDES=true；只验生产数据可忽略此项。");
  }

  const map = loadFeatureMap();
  if (!map) add("feature-map", "fail", `读不到 ${path.relative(ROOT, MAP_PATH)}`);
  else {
    const missing = [];
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
  if (!ok) process.exit(1);
}

async function cmdCards(flags) {
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
    const cards = {};
    for (const id of wanted) {
      const entry = map.cards[id];
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
    const missingRequired = required.filter((id) => cards[id].status !== "visible");
    const ok = missingRequired.length === 0 && consoleClean(sink);
    print({ ok, url: flags.url, viewport, cards, console: sink }, flags);
    if (!ok) process.exit(1);
  } finally {
    await browser.close();
  }
}

async function cmdShot(flags) {
  if (!flags.out) fail("shot 需要 --out <目录>", "例子：shot --url http://localhost:3291 --widths 1280,375 --out /tmp/shots", 2);
  const map = loadFeatureMap();
  const cardEntry = flags.card ? map?.cards?.[flags.card] : null;
  if (flags.card && !cardEntry) fail(`未知卡片 id：${flags.card}`, `可选：${map ? Object.keys(map.cards).join(", ") : "功能地图读不到"}`, 2);
  const viewports = parseWidths(flags.widths) ?? fail("--widths 格式如 1280,375", undefined, 2);
  if (flags.height) for (const v of viewports) v.height = Number(flags.height);
  const themes = flags.theme === "both" ? ["light", "dark"] : [flags.theme === "dark" ? "dark" : "light"];
  fs.mkdirSync(flags.out, { recursive: true });

  const pw = await resolvePlaywright() ?? fail("解不到 playwright / playwright-core", PLAYWRIGHT_NEXT);
  const shots = [];
  let failed = false;
  for (const theme of themes) {
    for (const viewport of viewports) {
      const sink = newSink();
      const runFlags = { ...flags, theme };
      let browser;
      try {
        const session = await openPage(pw.api, runFlags, viewport, sink);
        browser = session.browser;
        const { page } = session;
        await page.waitForTimeout(Number(flags.settle || 4000));
        if (!runFlags.ssr) await scrollSweep(page);
        const name = `${flags.card ?? "page"}-${viewport.width}x${viewport.height}-${theme}${runFlags.ssr ? "-ssr" : ""}.png`;
        const file = path.join(flags.out, name);
        if (flags.card && runFlags.ssr) {
          shots.push({ file: null, card: flags.card, ...viewport, theme, error: "--ssr 禁了 JavaScript，不能定位卡片；要 SSR 截图截整页", console: sink });
          failed = true;
          continue;
        }
        if (flags.card) {
          const el = await locateHandle(page, cardSpec(flags.card, cardEntry));
          if (!el) {
            shots.push({ file: null, card: flags.card, ...viewport, theme, error: "卡片在当前数据下不显示", console: sink });
            failed = true;
            continue;
          }
          await el.scrollIntoViewIfNeeded();
          await page.waitForTimeout(200);
          await el.screenshot({ path: file });
        } else {
          await page.screenshot({ path: file, fullPage: flags.viewport !== true });
        }
        shots.push({ file, card: flags.card ?? null, ...viewport, theme, console: sink });
      } catch (error) {
        failed = true;
        shots.push({ file: null, card: flags.card ?? null, ...viewport, theme, error: String(error?.message ?? error), console: sink });
      } finally {
        await browser?.close();
      }
    }
  }
  const ok = !failed && shots.every((s) => s.file && consoleClean(s.console));
  print({ ok, out: path.resolve(flags.out), shots }, flags);
  if (!ok) process.exit(1);
}

function cmdOverride(flags) {
  const argv = [];
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
  if (!ok) process.exit(result.status || 1);
}

async function main() {
  const { flags, positional } = parseArgs(process.argv.slice(2));
  const command = positional[0] ?? (flags.help ? "help" : null);
  flags.url = String(flags.url || DEFAULT_URL).replace(/\/+$/, "");
  if (!command || command === "help" || flags.help === true) {
    process.stdout.write(HELP);
    if (!command && !flags.help) process.exit(2);
    return;
  }
  if (command === "doctor") return cmdDoctor(flags);
  if (command === "cards") return cmdCards(flags);
  if (command === "shot") return cmdShot(flags);
  if (command === "override") return cmdOverride(flags);
  fail(`未知子命令：${command}`, "可用：doctor / cards / shot / override；--help 看全部选项", 2);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => fail(String(error?.message ?? error), "带 --help 看用法；疑似 bug 时把这条错误贴回主线程"));
}
