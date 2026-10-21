---
name: desktop-cls-scrollbar
description: Why desktop PSI CLS was 0.004 while mobile was 0 (late classic scrollbar shifting the centered main column), fixed in #534
metadata:
  type: project
---

Found 2026-10-21 (thread「桌面端 CLS 不为 0」). The home HTML (~570 KB) streams; when first paint lands before it finishes, the page is one viewport tall with no scrollbar. Then the classic 15px scrollbar appears and the centered 1024px `main > div.mx-auto` moves left 7.5px → CLS 0.00426 in about half of desktop Lighthouse runs. Mobile and macOS use overlay scrollbars, so 0. Fix #534: `html { scrollbar-gutter: stable }` in `src/app/styles/theme.css`.

A ~0.0002 residual remains: Geist Mono swapping in moves right-aligned short labels a few px (rounds to 0 on the card).

**How to apply:** Playwright headless passes `--hide-scrollbars`, so PerformanceObserver probes miss scrollbar shifts; launch with `ignoreDefaultArgs: ["--hide-scrollbars"]` or run local `lighthouse --preset=desktop` (npm i lighthouse@12 in scratchpad, CHROME_PATH=/opt/pw-browsers/chromium-*/chrome-linux/chrome). The PSI card shows a 6-hour median, so fixes take hours to show. Also seen that day: Workers Builds started no site build for #534's merge (pushed while #533's build ran); see [[workers-builds-parallel-race]]. Related: [[pagespeed-prod-after-501]].
