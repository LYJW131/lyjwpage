---
name: ui-before-after-reference-lines
description: Subtle UI changes ship before/after comparisons with reference lines: superimposed OVERLAY (red/cyan) or annotated side-by-side pair (K/M thread, praised); skip for outright redesigns
metadata:
  type: feedback
---

lyjw (2026-10-13 15:44Z): "UI 前后有变化的，截对比图，然后在上面搭参考线给我看清楚。" Then: "就是那种比较细微的变化，如果是整个变了的话，就不用。" Then (16:03Z) after seeing stacked top/bottom pairs: "这样子对比效果还是不太好…太细节了的话，要那种两张图叠在一起的，比较好看清一点。"

**Why:** lyjw judges UI by eye; stacked pairs made lyjw compare from memory, superimposed images show the shift directly.

**How to apply:** for subtle UI changes (skip when a component is redesigned outright), capture the same element on production (lyjw.me = before) and the dev server / preview (after), convert both to grayscale with ink dark (invert dark-theme shots so text and lines become dark on white) and superimpose: R channel = after, G/B = before → ink in both black, background white, before-only ink red, after-only ink cyan. Skipping the inversion swaps the colors. Box only elements whose measured value changed (font px, contrast ratio, hit-target height; pair before/after marks by position), labels red=before above, teal=after right. Upscale narrow (mobile) crops; if a block moved as a whole, align by the bottom or another anchor and say so. Script (Playwright + canvas, first used on PR #251): /mnt/project-files/design-md/tools/before-after-overlay.mjs; worth folding into `.claude/skills/lyjwpage-ui-design/`. Combines with [[design-md-ui-approval]] (lyjw OK before merge). hearthbot reply caps attached_outputs at 6 per call.

**Second approved style: annotated pair with measured reference lines** (K/M Today Tokens thread, PR #250; lyjw 2026-10-13 16:26Z: "这个的参考线对比做得不错!"). Good when the change is a size or width change inside a fixed frame:
- Get the same live data in both shots: run the dev server once with the before files and once with the after files. Commit (or stash) first, because `git checkout <merge>^1 -- <files>` overwrites uncommitted edits and `git checkout HEAD -- <files>` restores HEAD, not them. A second `git worktree` is the safer route. Use 1280 and 375 widths, dark theme, DPR 2, and hide fixed/sticky elements.
- Inject 1px absolute lines into the page before the element screenshot. Magenta horizontals span the panel at the glyph top and bottom. NumberFlow's box carries 0.25em mask padding, so subtract it. Cyan verticals mark the element's left and right edges, and an amber vertical marks the neighbouring column edge.
- Label chips state the measured px (`number 194px wide`, `gap 192px`). The reply names the before→after values per panel and says what the lines prove, e.g. "magenta at the same height: position and font size unchanged".
- Stitch with PIL: desktop BEFORE above AFTER, mobile side by side. The container has no CJK font, so labels must be English.
- Scripts: /mnt/project-files/agent-tokens-km/compare/tools/reference-lines-capture.mjs (args: before|after) and stitch.py.
