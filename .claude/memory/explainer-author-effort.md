---
name: explainer-author-effort
description: Explainer chapter authors run as Opus at effort xhigh (lyjw's setting); Haiku high does frame QA
metadata:
  type: feedback
---

Explainer animation chapter authors: model opus, effort xhigh. lyjw 2026-10-21 03:59 SGT 「把作者强度降到extra」, replacing 「作者强度用 opus high」 (2026-10-20) and the skill's older max. Recorded in `.claude/skills/lyjwpage-explainer/SKILL.md` step 3.

**Why:** cost control; lyjw also moved frame viewing to Haiku as too expensive on Opus.

**How to apply:** every explainer author Agent call uses `model: "opus", effort: "xhigh"`; frame QA stays Haiku high per [[verification-haiku-worker]].
