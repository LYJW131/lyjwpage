import fs from "node:fs";
import path from "node:path";

import { launchBrowser, resolvePlaywright, PLAYWRIGHT_NEXT } from "./browser.ts";
import { errorText, fail, print, ROOT, stringFlag, type Flags } from "./cli.ts";

// 1px 以内是亚像素取整，不算留白或裁切。
const TOLERANCE_PX = 1;
const CARD_PATH = /\/cards\/([a-z-]+)\.svg/g;

export type CardFit = { declared: number; filled: number; natural: number };

export function readmeCardNames(readme: string): string[] {
  return [...new Set([...readme.matchAll(CARD_PATH)].map((match) => match[1]))];
}

// filled：按写死的高度排版时卡片底边离画布顶多远；natural：放开高度后卡片自己要多高。
export function cardFitProblem({ declared, filled, natural }: CardFit): string | null {
  if (natural - declared > TOLERANCE_PX) return `内容要 ${natural}px，卡高只给 ${declared}px，底部被裁 ${natural - declared}px`;
  if (declared - filled > TOLERANCE_PX) return `卡高 ${declared}px，内容只到 ${filled}px，底部留白 ${declared - filled}px`;
  return null;
}

// README 卡是套了一层 <image> 的 SVG（src/app/cards/svg-document.ts#scalableSvg），量的是里层那张。
export function innerCardSvg(outer: string): string | null {
  const base64 = /href="data:image\/svg\+xml;base64,([^"]+)"/.exec(outer)?.[1];
  return base64 ? Buffer.from(base64, "base64").toString("utf8") : null;
}

// 有 .paper-card 就量卡片边框：硬阴影画在 SHADOW_PAD 里，不算内容；没有的量外层容器的常规流子元素。
const MEASURE = `(() => {
  const box = document.querySelector("foreignObject > div");
  const wrap = box && box.lastElementChild;
  if (!wrap) return null;
  const card = wrap.querySelector(".paper-card");
  const top = box.getBoundingClientRect().top;
  const bottom = () => card
    ? card.getBoundingClientRect().bottom
    : Math.max(top, ...[...wrap.children].filter((el) => getComputedStyle(el).position !== "absolute").map((el) => el.getBoundingClientRect().bottom));
  const round = (n) => Math.round(n * 10) / 10;
  const declared = round(box.getBoundingClientRect().height);
  const filled = round(bottom() - top);
  box.style.height = "auto";
  wrap.style.flex = "none";
  return { declared, filled, natural: round(bottom() - top) };
})()`;

export async function cmdReadmeCards(flags: Flags) {
  const names = stringFlag(flags.card)?.split(",").map((s) => s.trim()).filter(Boolean)
    ?? readmeCardNames(fs.readFileSync(path.join(ROOT, "README.md"), "utf8"));
  if (!names.length) fail("没找到要量的卡片", "README.md 里应有 /cards/<卡>.svg 链接，或用 --card 点名", 2);
  const pw = await resolvePlaywright() ?? fail("解不到 playwright / playwright-core", PLAYWRIGHT_NEXT);
  const theme = flags.theme === "dark" ? "dark" : "light";
  const { browser } = await launchBrowser(pw.api, flags);
  const cards: Record<string, { ok: boolean; problem?: string } & Partial<CardFit>> = {};
  try {
    const page = await (await browser.newContext({})).newPage();
    let current = "";
    await page.route((url) => url.hostname === "card.invalid", (route) => route.fulfill({ contentType: "image/svg+xml", body: current }));
    for (const name of names) {
      try {
        // 卡片按 URL 在边缘缓存十分钟，带一个没人用的参数取刚部署的那版。
        const response = await fetch(`${flags.url}/cards/${name}.svg?theme=${theme}&fresh=${Date.now()}`, { signal: AbortSignal.timeout(30_000) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const inner = innerCardSvg(await response.text());
        if (!inner) throw new Error("响应里没有内层 SVG");
        current = inner;
        await page.goto(`http://card.invalid/${name}.svg`, { waitUntil: "load", timeout: 30_000 });
        const fit = (await page.evaluate(MEASURE)) as CardFit | null;
        if (!fit) throw new Error("内层 SVG 里没有 foreignObject 卡片容器");
        const problem = cardFitProblem(fit);
        cards[name] = { ok: !problem, ...fit, ...(problem ? { problem } : {}) };
      } catch (error) {
        cards[name] = { ok: false, problem: `没量成：${errorText(error)}` };
      }
    }
  } finally {
    await browser.close();
  }
  const bad = Object.entries(cards).filter(([, card]) => !card.ok);
  const ok = bad.length === 0;
  print(
    {
      ok,
      ...(ok ? {} : { next: `改 src/app/cards/route.tsx 里这几张卡的 height：${bad.map(([name, card]) => `${name}（${card.problem}）`).join("；")}` }),
      url: flags.url,
      theme,
      cards,
    },
    flags,
  );
  if (!ok) process.exitCode = 1;
}
