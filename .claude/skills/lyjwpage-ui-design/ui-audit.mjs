#!/usr/bin/env node
// 用法：node .claude/skills/lyjwpage-ui-design/ui-audit.mjs [url] [--dark] [--only=<卡片 id 或表头文字>]
// 默认 url 是 http://localhost:3211/，量 1280 与 375 两个宽度，只读不改页面。
import { execSync } from "node:child_process";
import { createRequire } from "node:module";

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith("--")) ?? "http://localhost:3211/";
const dark = args.includes("--dark");
const only = args.find((a) => a.startsWith("--only="))?.slice(7).toLowerCase();
// createRequire 不搜 npm 全局目录，所以先问 `npm root -g`，再退到云端容器预装的那份。
const loadPlaywright = () => {
  let globalRoot = "";
  try {
    globalRoot = `${execSync("npm root -g", { encoding: "utf8" }).trim()}/`;
  } catch {}
  for (const base of [`${process.cwd()}/`, globalRoot, "/opt/node22/lib/node_modules/"].filter(Boolean)) {
    try {
      return createRequire(base)("playwright");
    } catch {}
  }
  console.error("找不到 playwright：本机先 `npm i -g playwright && npx playwright install chromium`，或在云端容器里跑。");
  process.exit(1);
};
const { chromium } = loadPlaywright();

const TYPE_SCALE = [11, 12, 14, 16, 18, 20, 24, 30, 36, 48, 60, 72, 96];

const browser = await chromium.launch();
for (const [width, height] of [[1280, 900], [375, 812]]) {
  const page = await browser.newPage({ viewport: { width, height }, colorScheme: dark ? "dark" : "light" });
  // 页面一直在轮询并开着 WebSocket，networkidle 永远等不到。
  await page.goto(url, { waitUntil: "load", timeout: 60000 });
  await page.waitForTimeout(5000);
  // 屏外卡片用了 content-visibility，滚一遍才有布局。
  for (let y = 0; y < 15000; y += 600) {
    await page.evaluate((top) => scrollTo(0, top), y);
    await page.waitForTimeout(100);
  }
  const report = await page.evaluate(({ only, TYPE_SCALE }) => {
    const visible = (el) => {
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && +style.opacity > 0 && !el.closest("[aria-hidden='true'],[inert],[hidden]");
    };
    const textBoxes = (root, skip) => {
      const out = [];
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const node = walker.currentNode;
        const el = node.parentElement;
        if (!node.textContent.trim() || !visible(el) || (skip && skip.contains(el)) || el.closest("svg")) continue;
        const range = document.createRange();
        range.selectNodeContents(node);
        const box = range.getBoundingClientRect();
        if (box.width) out.push({ el, box, size: parseFloat(getComputedStyle(el).fontSize), weight: getComputedStyle(el).fontWeight });
      }
      return out;
    };
    const cards = [...document.querySelectorAll(".paper-card")].filter((c) => visible(c) && c.getBoundingClientRect().height > 60 && !c.parentElement.closest(".paper-card"));
    const rows = new Map();
    const result = [];
    for (const card of cards) {
      const box = card.getBoundingClientRect();
      const header = card.querySelector(":scope > .border-b.bg-muted");
      const name = card.id || header?.innerText.split("\n")[0].trim() || card.innerText.slice(0, 24).trim();
      const top = Math.round(box.top + scrollY);
      rows.set(top, [...(rows.get(top) ?? []), { name, h: Math.round(box.height) }]);
      if (only && !name.toLowerCase().includes(only)) continue;
      const texts = textBoxes(card, header);
      const media = [...card.querySelectorAll("img, canvas, video, svg:not(svg svg)")].filter((el) => visible(el) && !(header && header.contains(el)));
      const edges = (boxes) => [...new Set(boxes.map((b) => Math.round(b.left - box.left)).filter((x) => x < 48))].sort((a, b) => a - b);
      const headerLabel = header && textBoxes(header)[0];
      const sizes = {};
      for (const t of texts) sizes[`${t.size}/${t.weight}`] = (sizes[`${t.size}/${t.weight}`] ?? 0) + 1;
      result.push({
        card: name,
        size: `${Math.round(box.width)}×${Math.round(box.height)}`,
        headerLabelInset: headerLabel ? Math.round(headerLabel.box.left - box.left) : null,
        textInsets: edges(texts.map((t) => t.box)),
        mediaInsets: edges(media.map((el) => el.getBoundingClientRect())),
        offScaleText: texts.filter((t) => !TYPE_SCALE.includes(t.size)).map((t) => `${t.size}px "${t.el.textContent.trim().slice(0, 16)}"`).slice(0, 8),
        typeUsage: sizes,
      });
    }
    const controls = [...document.querySelectorAll("a[href],button,[role=button],[role=tab],input,select,textarea")].filter(visible);
    const label = (el) => (el.getAttribute("aria-label") || el.innerText || el.title || "").trim().replace(/\s+/g, " ");
    const smallTargets = controls
      .map((el) => ({ el, box: el.getBoundingClientRect() }))
      .filter(({ el, box }) => (box.width < 24 || box.height < 24) && !el.closest(".github-chart"))
      .map(({ el, box }) => `${label(el).slice(0, 24) || el.tagName} ${Math.round(box.width)}×${Math.round(box.height)}`);
    const unnamed = controls.filter((el) => !label(el) && !el.getAttribute("aria-labelledby")).map((el) => el.outerHTML.slice(0, 90));
    const unequalRows = [...rows.values()]
      .filter((r) => !only || r.some((c) => c.name.toLowerCase().includes(only)))
      .filter((r) => r.length > 1 && new Set(r.map((c) => c.h)).size > 1);
    return { cards: result, unequalRows, smallTargets: [...new Set(smallTargets)], unnamed };
  }, { only, TYPE_SCALE });
  console.log(`\n===== ${width}px${dark ? " dark" : ""} =====`);
  console.log(JSON.stringify(report, null, 1));
  await page.close();
}
await browser.close();
