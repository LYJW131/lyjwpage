---
name: verify-in-actions-plan
description: Discussed 2026-10-23 moving Haiku verifier + Opus judge into GitHub Actions; lyjw chose parallel judge; not built yet
metadata:
  type: project
---

Thread「独立验证员何时出场」2026-10-23 15:45–15:54 SGT: lyjw floated moving the Haiku verification flow into a GitHub Action (started as "只是讨论一下").

Shape agreed so far:
- Thread pushes with a fixed-format 验证清单 + lyjw's original words in the PR body.
- After the branch site preview deploys, an Action runs Haiku (lyjw's setup-token, subscription quota, like claude-code-review.yml): browser checks on `<branch>.preview.lyjw.dev`, desktop/375/WebKit shots attached to PR, reload/revert-proof when needed, bot-signed receipt; `verify-receipt.ts` would trust only the bot for receipts, so threads can't self-sign. Docs/skill-only PRs skip.
- Logic-tier PRs: Opus judge runs **in parallel** with Haiku (lyjw 07:54Z「并行跑」), answering only "did it do what lyjw asked / regressions"; a light step reconciles evidence table vs checklist afterwards. Cost accepted: Opus per push on weekly quota.
- lyjw: money and visitor-PR security are not concerns (PRs locked; visitors only via the design flow). Actions queue stalls are GitHub flakiness, not our job count (one CI = 1 job ~1.5–2 min).
- Gaps: states needing `dev:scene` fixtures can't be shown on preview; real-device checks stay with lyjw.

Status: discussion only, nothing built as of 2026-10-23. Related: [[verification-haiku-worker]], [[merge-requires-bot-review-pass]].
