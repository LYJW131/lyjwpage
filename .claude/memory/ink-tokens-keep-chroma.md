---
name: ink-tokens-keep-chroma
description: When darkening/brightening a colour for text contrast, change lightness only; dropping chroma made the owner see the site "turn grey" (PR #251)
metadata:
  type: feedback
---

lyjw (2026-10-13 16:31Z) on PR #251 preview: 「颜色为什么整体变淡了」「变灰了」「不是 真的变灰」「看数字」 — the perf scores (62/51) went from amber-600 orange to a low-chroma yellow/brown after I swapped them to `live-idle-ink`, and dark signal colours had chroma cut to ~0.11.

**Why:** the owner notices saturation loss immediately, even when contrast numbers improved.

**How to apply:** for any contrast fix, keep hue and chroma close to the original and move only L (oklch). Compare computed colours prod vs preview in both themes (getComputedStyle) and send colour side-by-sides — never only grayscale overlays when colours changed. See [[ui-before-after-reference-lines]].
