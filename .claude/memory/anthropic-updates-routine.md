---
name: anthropic-updates-routine
description: Daily 08:41 Asia/Shanghai routine that pulls new Anthropic official posts/docs/changelog/X by bookmark and writes anthropic-updates/<date>.md for the 9:00 morning report
metadata:
  type: project
---

Created 2026-10-14 at lyjw's request ("每天定时去拉 Anthropic 官方博客，新文档这些的…在晨报中给我总结，并且研究一下能否吸收"). Routine `trig_018iJkbi7mFUooibqwrbW7N8` ("lyjwpage Anthropic 官方动态"), cron `CRON_TZ=Asia/Shanghai 41 8 * * *`, fires into the project thread "Anthropic 官方动态日更 + collector 盯防". Thin prompt: each run reads `origin/main:.claude/skills/lyjwpage-anthropic-updates/SKILL.md` and runs its `fetch.py`.

Sources (expanded 2026-10-14 06:32Z at lyjw's request "信息来源可以多一点…土豆…我给你发那个人…再去找一些其他的信息来源", PR #290). The lists live in `fetch.py`: `SET_SOURCES` (anthropic.com news and engineering, claude.dev blog, the claude.com/resources/articles blog, docs, release notes, Simon Willison entries, Latent Space, the Cloudflare changelog filtered by `CLOUDFLARE_PRODUCTS`, and HN stories over 150 points whose title or URL names Claude or Anthropic), `VERSION_SOURCES` (the Claude Code and anthropic-sdk-typescript CHANGELOGs) and `X_ACCOUNTS`:
- official: AnthropicAI, claudeai, ClaudeDevs
- anthropic: bcherny, _catwu, trq212, alexalbert__
- builders: poteto (土豆 = Lauren Tan), mattpocockuk ("the person lyjw sent"), karpathy, HamelHusain

X cursors are kept per account (`cursors.x` = {username: since_id}). A new source or account reports only its last 36h on first sight. GitHub releases.atom is blocked in cloud sessions, so use raw CHANGELOG files instead.

**State:** `/mnt/project-files/anthropic-updates/` — `state.json` (cursors for claude-code version and x since_id, `ledger` of open "可吸收" items), `seen/<source>.txt` seen-key sets, `runs/` records, `<Shanghai date>.md` summary (appends when the file exists). `fetch.py scan` writes `pending.json`; `commit <sources>` advances only after the summary is read back.

**Contract with the coordinator:** the routine never posts in the project chat and never opens PRs; the coordinator's 9:00 morning report reads the dated file and relays "要你决定的". Absorbing an item is a separate thread under normal merge gates.

First item (2026-10-14): Scion engineering post; its "superfan" idea was approved and built as [[collector-superfan-routine]].

Practices: [[agent-automation-practices]]. Siblings: [[lyjwpage-daily-review-routine]], [[skill-mining-routine]].
