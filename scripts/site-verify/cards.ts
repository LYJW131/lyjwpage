import fs from "node:fs";
import path from "node:path";

import { launchBrowser, launchEngine, locate, locateHandle, openPage, PLAYWRIGHT_NEXT, WEBKIT_NEXT, resolvePlaywright, scrollSweep, HIDE_DEV_UI, type CardSpec, type PwBrowser } from "./browser.ts";
import { errorText, fail, parseWidths, print, ROOT, stringFlag, WORKER_URL, type Box, type Flags, type Viewport } from "./cli.ts";
import { consoleClean, consoleProblems, newSink, type Sink } from "./console-sink.ts";

const MAP_PATH = path.join(ROOT, ".claude", "skills", "lyjwpage-verify", "feature-map.json");

type CardEntry = { component: string; selector?: string; alternates?: string[]; cardLabel?: string; conditional?: boolean; endpoints?: Record<string, string[]>; proves?: unknown };
export type FeatureMap = { cards: Record<string, CardEntry> };

export function loadFeatureMap(mapPath = MAP_PATH): FeatureMap | null {
  if (!fs.existsSync(mapPath)) return null;
  return JSON.parse(fs.readFileSync(mapPath, "utf8")) as FeatureMap;
}

// --card 显式点名就是期望它出现：conditional 卡被点名时也算 required。
export function requiredCardIds(map: { cards: Record<string, { conditional?: boolean }> }, wanted: string[], explicit: boolean): string[] {
  return explicit ? wanted : wanted.filter((id) => !map.cards[id]?.conditional);
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

function cardSpec(id: string, entry: CardEntry): CardSpec {
  return { id, selector: entry.selector, alternates: entry.alternates, cardLabel: entry.cardLabel };
}

export async function cmdDoctor(flags: Flags) {
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

export async function cmdCards(flags: Flags) {
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

export async function cmdShot(flags: Flags) {
  const out = stringFlag(flags.out) ?? fail("shot 需要 --out <目录>", "例子：shot --url http://localhost:3291 --widths 1280,375 --out /tmp/shots", 2);
  const map = loadFeatureMap();
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
