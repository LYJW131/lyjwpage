---
name: anthropic-updates-routine
description: Daily 08:41 Asia/Shanghai routine that pulls new Anthropic official posts/docs/changelog/X by bookmark and writes anthropic-updates/<date>.md for the 9:00 morning report
metadata:
  type: project
---

Created 2026-10-14 at lyjw's request ("每天定时去拉 Anthropic 官方博客，新文档这些的…在晨报中给我总结，并且研究一下能否吸收"). Routine `trig_018iJkbi7mFUooibqwrbW7N8` ("lyjwpage Anthropic 官方动态"), cron `CRON_TZ=Asia/Shanghai 41 8 * * *`, fires into the project thread "Anthropic 官方动态日更". Thin prompt: each run reads `origin/main:.claude/skills/lyjwpage-anthropic-updates/SKILL.md` and runs its `fetch.py`.

Sources (6): anthropic.com news+engineering (sitemap), claude.dev blog (sitemap), platform release notes (`overview.md`), platform+code.claude.com English docs pages (sitemaps), Claude Code CHANGELOG (raw.githubusercontent), @AnthropicAI X timeline (user id 1353836358901501952, via [[x-api-via-proxy]]).

**State:** `/mnt/project-files/anthropic-updates/` — `state.json` (cursors for claude-code version and x since_id, `ledger` of open "可吸收" items), `seen/<source>.txt` seen-key sets, `runs/` records, `<Shanghai date>.md` summary (appends when the file exists). `fetch.py scan` writes `pending.json`; `commit <sources>` advances only after the summary is read back.

**Contract with the coordinator:** the routine never posts in the project chat and never opens PRs; the coordinator's 9:00 morning report reads the dated file and relays "要你决定的". Absorbing an item is a separate thread under normal merge gates.

First item (2026-10-14): Scion engineering post; open ledger item `superfan-collector` (a routine that only watches collector Worker health via Sentry) awaits the user's yes/no.

Practices: [[agent-automation-practices]]. Siblings: [[lyjwpage-daily-review-routine]], [[skill-mining-routine]].
