---
name: design-md-ui-approval
description: Site UI follows root DESIGN.md (spacing/type/color spec, 2026-10-13); any UI/UX change needs lyjw's look-and-OK before merging to main unless it is a small change lyjw explicitly asked for
metadata:
  type: feedback
---

lyjw (2026-10-13 13:06): "这几次做的东西 间距看起来都不太舒服 … 在本项目固定一个设计规范吧 就是 DESIGN.md". Root `DESIGN.md` is the site's visual/interaction spec (tokens stay in `src/app/globals.css`); the old AGENTS.md sections 「界面与交互」 and the icon half of 「图标与图片」 moved into it. Self-check skill with a measuring script: `.claude/skills/lyjwpage-ui-design/` (`ui-audit.mjs`).

lyjw (2026-10-13 13:13): "有ui/ux变化的改动进main,只要不是明确要求的小改动,合并前都要问我".

**Why:** lyjw judges UI by eye; agent-picked spacing drifted (header label 12px vs body 20px, 10px text, off-scale half steps) and recent cards felt off.

**How to apply:** before any site UI work read DESIGN.md and use the lyjwpage-ui-design skill. A PR with any UI/UX change waits for lyjw's explicit OK after screenshots, even when CI is green; this overrides [[ui-prs-merge-without-bot-review]] and [[push-to-merge-authorizes-merge]] for UI. Docs-only PRs (including DESIGN.md text) still merge on green CI. Spec-violation fixes from the DESIGN.md audit are follow-up PRs that need lyjw's go.
