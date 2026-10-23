---
name: verify-in-actions-plan
description: Verify Action (Haiku verifier + parallel Opus judge in GitHub Actions, bot-signed receipts) built in PR #572; facts learned while testing it
metadata:
  type: project
---

lyjw 2026-10-23 16:03 SGT asked to move the verifier fully into GitHub Actions, test it, and debug the hollow claude-review. Built in PR #572 (`.github/workflows/verify.yml`, `scripts/verify-action.ts`). How it works lives in skill `lyjwpage-verify`「PR 上的验证：Verify Action」; don't duplicate it here.

Decisions lyjw made (don't re-ask):
- **Ask lyjw before the final merge of #572** (lyjw 2026-10-23 16:32 SGT「这个pr最终合并前先问我」).
- PR body carries「## 验证清单」(V1…) and「## lyjw 原话」; the Action verifies against them.
- Money is fine (setup-token, subscription quota). Visitor-PR security is not a concern (PRs locked; visitors only via the design flow).
- A PR that edits the verifier can forge its own receipt; lyjw 2026-10-23 17:12 SGT「不堵了 只标记出来改过验证员」: no blocking, `pr-tier-label.yml` puts a red `verifier-changed` label on it (paths: `scripts/pr-gate/tier.ts#verifierFiles`). Don't re-propose pull_request_target.
- PR tier labels `tier: docs/ui/logic/ui+logic` by `lyjw131[bot]` are display only (lyjw「我只是想看而已」, #586); gates never read them.
- Opus judge runs **in parallel** with the Haiku verifier on logic-tier PRs (「并行跑」).

Facts learned from real runs (2026-10-23):
- First end-to-end run (39923479225) took ~4.5 min; both models found real bugs (empty-evidence receipts, title-edit cancelling verification).
- claude-code-action restores `.claude/`, `CLAUDE.md` etc. from main on PRs ("PR head is untrusted"); PR copies land in `.claude-pr/`. So the verifier follows main's skill; skill edits take effect after merge.
- Workflow-level `concurrency` applies before job `if`, so a no-op `edited` event must go to a different group.
- `actions/setup-node` auto package-manager cache fails without pnpm installed: set `package-manager-cache: false` on jobs that skip pnpm.
- `playwright install --with-deps` once hung 40+ min silently; the step now has a 5-min timeout with one retry.
- Receipts carry `<!-- 描述摘要 <sha256> -->` on line 2; editing the checklist or lyjw's words voids old receipts.

Code-review diagnosis: [[claude-review-hollow]]. Related: [[verification-haiku-worker]], [[merge-requires-bot-review-pass]].
