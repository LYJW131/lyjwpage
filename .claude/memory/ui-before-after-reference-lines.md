---
name: ui-before-after-reference-lines
description: Subtle UI changes (spacing, size, colour tweaks) ship before/after comparison screenshots with reference lines overlaid; not needed for outright redesigns
metadata:
  type: feedback
---

lyjw (2026-10-13 15:44Z): "UI 前后有变化的，截对比图，然后在上面搭参考线给我看清楚。" Then: "就是那种比较细微的变化，如果是整个变了的话，就不用。"

**Why:** the owner judges UI by eye and wants differences obvious without hunting; plain after-screenshots made him compare from memory.

**How to apply:** for subtle UI changes (skip when a component is redesigned outright), crop each changed region on production (lyjw.me = before) and the dev server / preview (after), overlay marks, and stack them BEFORE above AFTER in one image. Done first on PR #251: a Playwright script injected boxes on every text node <12px labelled with rendered px, colored-text boxes labelled with contrast ratio (red if <11px or <4.5:1, green otherwise), and dashed boxes on links/buttons labelled with height (red <24px). Script kept at session scratchpad `cmp/compare.mjs`; worth folding into `.claude/skills/lyjwpage-ui-design/` as a reusable tool. For spacing/alignment changes, draw vertical inset lines and row-height marks instead. Combines with [[design-md-ui-approval]] (owner OK before merge). hearthbot reply caps attached_outputs at 6 per call.
