---
name: design-md-ui-approval
description: Site UI follows root DESIGN.md (spacing/type/color spec, 2026-10-13); any UI/UX change needs lyjw's look-and-OK before merging to main unless it is a small change lyjw explicitly asked for
metadata:
  type: feedback
---

lyjw (2026-10-13 13:06): "这几次做的东西 间距看起来都不太舒服 … 在本项目固定一个设计规范吧 就是 DESIGN.md". Root `DESIGN.md` is the site's visual/interaction spec (tokens stay in `src/app/styles/theme.css`); the old AGENTS.md sections 「界面与交互」 and the icon half of 「图标与图片」 moved into it. Self-check skill with a measuring script: `.claude/skills/lyjwpage-ui-design/` (`ui-audit.mjs`).

lyjw (2026-10-13 13:13): "有ui/ux变化的改动进main,只要不是明确要求的小改动,合并前都要问我".

**Why:** lyjw judges UI by eye; agent-picked spacing drifted (header label 12px vs body 20px, 10px text, off-scale half steps) and recent cards felt off.

**How to apply:** before any site UI work read DESIGN.md and use the lyjwpage-ui-design skill. A PR with any UI/UX change waits for lyjw's explicit OK after screenshots, even when CI is green; this overrides [[ui-prs-merge-without-bot-review]] and [[push-to-merge-authorizes-merge]] for UI. Docs-only PRs (including DESIGN.md text) still merge on green CI. Spec-violation fixes from the DESIGN.md audit are follow-up PRs that need lyjw's go.

Asking and exceptions:
- Cloud review asks wait until the branch preview (`<branch>.preview.lyjw.dev`) has deployed, then ping lyjw with the link (2026-10-21).
- Ask for the UI OK with a decision card that has an "OK / 合并" option, not by asking lyjw to type 同意 (lyjw 2026-10-23 17:34 SGT: usually it is OK; lyjw types only when something needs changing).
- **Small changes lyjw explicitly asked for skip the OK** (lyjw 2026-10-30 11:39 SGT on #774 default dark mode:「是我明确要求的小改动而已 ui的话 也没有新增 只是我明确要求的改变行为而已」): lyjw named the change, it alters existing behavior/style and adds no new UI → merge once verification passes; still put the Before | After table in the PR. No decision card.
- Clear bug fixes and small changes merge without asking, UI included (2026-10-20). "Clear fix" = behavior broken; a display inconsistency is not one: check `git log -S` for an intentional choice first (HUMAN.md #495).
- Contrast fixes change oklch lightness only: [[ink-tokens-keep-chroma]]. Subtle tweaks get before/after overlays: [[ui-before-after-reference-lines]].
