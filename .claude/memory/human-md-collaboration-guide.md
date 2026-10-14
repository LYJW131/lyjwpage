---
name: human-md-collaboration-guide
description: Root HUMAN.md is the lyjw-facing statement of how lyjw and Claude collaborate (asks, decisions, merge gate, deploy acceptance, memory); merged as PR #208 on 2026-10-13
metadata:
  type: project
---

lyjw asked (2026-10-13) for a Chinese `HUMAN.md` at the repo root, written for lyjw, that sets how lyjw and Claude communicate and split work. It mirrors the conventions already in memory ([[merge-requires-bot-review-pass]], [[credentials-pipe-only]], [[workers-builds-parallel-race]], [[lyjwpage-daily-review-routine]]) and points to AGENTS.md / docs/ops-facts.md instead of copying values. Delivered and merged as PR #208 (thread "写 HUMAN.md 协作指南"); lyjw said 合 after reading it, without waiting for Codex round 2 on a docs-only PR. The same PR fixed two stale doc lines: ops-facts now says `main` has branch protection (required conversation resolution only), and AGENTS.md lists `discord-reporter` among the misaka-jp reporters that auto-deploy.

**Why:** lyjw wants one place that states the collaboration protocol for lyjw; threads should not re-derive it from scattered memory.

**How to apply:** when lyjw states a new working rule in chat, update memory as usual and also check whether `HUMAN.md` needs the same change (open a small docs PR). For heavy doc/code/history reading in such writing tasks, delegate to Sonnet/Haiku subagents; lyjw asked for that explicitly ("大量查文档翻代码的事去派 sonnet 或者 haiku").
