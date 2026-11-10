---
name: readme-cards-mirror-site
description: README live SVG cards must faithfully show everything the homepage card shows, including interactive controls; fix height, never drop elements
metadata:
  type: feedback
---

2026-11-11 02:49 SGT, thread「限额图加重置卡使用预测」: the reset-card toggle made `/cards/vibe-coding.svg` 38px taller than its fixed height, and I stripped the toggle from the README card ("a static image can't be clicked"). lyjw:「页面上有的控件为什么不画」「肯定忠实的展示站点情况啊」.

**Why:** README cards exist to show the live site as it is; a missing control misrepresents the page.
**How to apply:** when a homepage change makes a README card clip (CI `readme-cards`), grow the card height in `src/app/cards/route.tsx` under the same condition the page uses; never hide page elements in the card. Related: [[site-small-decisions]].
