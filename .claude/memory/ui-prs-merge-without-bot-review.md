---
name: ui-prs-merge-without-bot-review
description: Pure UI-tweak PRs in lyjwpage merge once CI is green, without waiting for bot reviews (Codex/Devin/Claude/Bugbot)
metadata:
  type: feedback
---

lyjw (2026-10-13, exit node card thread, PR #229): "改个ui天天等他审核干嘛 记住了".

Rule: for a PR that only changes site UI (classes, layout, copy, styling in components), merge as soon as CI (`check`, `Workers Builds: site`) is green. Do not wait for Codex / Devin / Claude review / Bugbot to post on the latest head. If a bot finding has already landed by merge time, still glance at it; a real red-circle bug still blocks.

**Why:** waiting several minutes per round for bots on small UI tweaks slows the user's live iteration loop for little value.

**How to apply:** this narrows [[merge-requires-bot-review-pass]] for UI-only PRs. Logic, API, worker, security or contract changes still go through the full bot-review gate. HUMAN.md should say the same ([[human-md-collaboration-guide]]).

Superseded for merge timing by [[design-md-ui-approval]]: UI/UX PRs still skip the bot-review wait, but now wait for the owner's OK (unless a small change they explicitly asked for).
