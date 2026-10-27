---
name: anthropic-updates-routine
description: Daily 08:41 Asia/Shanghai routine that pulls new Anthropic official posts/docs/changelog/X by bookmark and writes anthropic-updates/<date>.md for the 10:56 morning report
metadata:
  type: project
---

Created 2026-10-14 at lyjw's request ("每天定时去拉 Anthropic 官方博客，新文档这些的…在晨报中给我总结，并且研究一下能否吸收"). Routine `trig_01AkxcodeNefhYzfdZ7zmpz4` ("lyjwpage Anthropic 官方动态"), cron `CRON_TZ=Asia/Shanghai 41 8 * * *`, fires into the project thread "Anthropic 官方动态 · 定时任务" (<internal id>, has the LYJW MCP Portal connector). Moved there 2026-10-27 (lyjw「换新会话吧」); old `trig_018iJkbi7mFUooibqwrbW7N8` in <internal id> lacked the connector and is disabled, not deleted. Thin prompt: each run reads `origin/main:.claude/skills/lyjwpage-anthropic-updates/SKILL.md` and runs its `fetch.py`.

Sources (expanded 2026-10-14 06:32Z at lyjw's request "信息来源可以多一点…土豆…我给你发那个人…再去找一些其他的信息来源", PR #290). The lists live in `fetch.py`: `SET_SOURCES` (anthropic.com news and engineering, claude.dev blog, the claude.com/resources/articles blog, docs, release notes, Simon Willison entries, Latent Space, the Cloudflare changelog filtered by `CLOUDFLARE_PRODUCTS`, and HN stories over 150 points whose title or URL names Claude or Anthropic), `VERSION_SOURCES` (the Claude Code and anthropic-sdk-typescript CHANGELOGs) and `X_ACCOUNTS`:
- official: AnthropicAI, claudeai, ClaudeDevs
- anthropic: bcherny, _catwu, alexalbert__, felixrieseberg
- builders: poteto (土豆 = Lauren Tan), trq212 (left Anthropic 2026-10-24, moved here at lyjw's OK), mattpocockuk ("the person lyjw sent"), karpathy, HamelHusain

Since 2026-10-26 (lyjw「改mcp 顺便一起看我的点赞和收藏」) X is read through the `LYJW MCP Portal` connector ([[x-mcp-portal]]), not the api.x.com proxy: `fetch.py x-plan` emits JS snippets, the reader runs them via `portal_codemode_execute`, `fetch.py x-ingest` books them. New sources `x-likes` / `x-bookmarks` (lyjw's own likes and bookmarks; cursor = last 50 seen ids). X cursors are kept per account (`cursors.x` = {username: since_id}). A new source or account reports only its last 36h on first sight. GitHub releases.atom is blocked in cloud sessions, so use raw CHANGELOG files instead.

**State:** `/mnt/project-files/anthropic-updates/` — `state.json` (cursors for claude-code version and x since_id, `ledger` of open "可吸收" items), `seen/<source>.txt` seen-key sets, `runs/` records, `<Shanghai date>.md` summary (appends when the file exists). `fetch.py scan` writes `pending.json`; `commit <sources>` advances only after the summary is read back.

**Contract with the morning report:** the routine never posts in the project chat and never opens PRs; the 10:56 morning-report routine ([[morning-report-routine]]) reads the dated file and relays only the absorbable items. Absorbing an item is a separate thread under normal merge gates.

**Settled, don't re-propose (lyjw 2026-10-15):** sending the ai Worker's Claude Platform usage/traces (OTel) into Pulse or ingress — "这又不是我的用量" (visitors spend it, not lyjw); Max-plan API credits — already claimed, the ai Worker runs on them.

First item (2026-10-14): Scion engineering post; its "superfan" idea was approved and built as [[collector-superfan-routine]].

Practices: [[agent-automation-practices]]. Siblings: [[lyjwpage-daily-review-routine]], [[skill-mining-routine]].
