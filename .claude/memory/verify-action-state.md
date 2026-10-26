---
name: verify-action-state
description: Current state of the Verify Action in GitHub Actions (labels, verifier effort, notes-only receipt reuse, incremental re-verify) as of 2026-10-26
metadata:
  type: project
---

Design and decisions: [[verify-in-actions-plan]]. Independent review (需先修): [[verify-action-review-572]]. Official claude-review fix (Opus orchestrator, logic tier only): [[claude-review-hollow]].

- #572 merged; receipt gaps only warn, never block; receipts and judges are posted as lyjw131[bot].
- `lyjw131[bot]` labels `tier: …` (display only, #586) and `verifier-changed` (mark, don't block).
- Verifier effort A/B (#625) ended 2026-10-25 after 31 runs: high catches more real defects, so the verifier stays on high and the A/B job is removed (#659); the 10-27 reminder is superseded: [[verify-effort-ab-result]].
- A passing receipt is reused when later pushes only touch docs or code comments (`notes-only`, #659), only on PRs opened by lyjw's accounts (lyjw picked「限制作者」2026-10-26 05:00 SGT, #670).
- Retro 2026-10-26 (keep it; upkeep is the cost; freeze proposal pending): [[verify-actions-retro]].
- Incremental re-verify (reuse the prior receipt, recheck only failed or touched items): lyjw OK'd 2026-10-26, #677.
