---
name: verify-action-review-572
description: Independent review of PR #572 (Verify Action) at head 204a273 on 2026-10-23: verdict 需先修, and the workflow security rules it produced
metadata:
  type: project
---

lyjw 2026-10-23 17:47 SGT asked for an independent Opus 5.5 max review of #572 and, at 18:02 SGT, let the reviewer make the calls and send hands-on tests to low-effort subagents. Report: [Verify Action 评审](<private claude.ai link>). Patches: /mnt/project-files/pr572-review/ (f1-fix.diff tested, f2-scrub.diff needs one real run). Must-fix items were handed to the building thread.

Rules that came out of it:
- Scripts that workflows run from the PR checkout in jobs holding write tokens or secrets (verify.yml publish, pr-tier-label.yml, claude-code-review.yml) must import only from `scripts/`. The visitor design flow may write `shared/` (`workers/ai/src/build/validation.ts#allowedBuildPath`), so hash with `node:crypto` there, not `shared/sha256.ts`.
- Claude steps that run PR code need `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1'`. claude-code-action sets it only with `allowed_non_write_users`; otherwise Bash subprocesses see `CLAUDE_CODE_OAUTH_TOKEN`.
- Receipt signer github-actions[bot] means any workflow on any branch. The merge gate stays advisory: main has no required checks, and `pr-gate.ts` still honors `--need` / `--no-judge` on lyjw-account PRs.

Follow-ups (not blocking): add AGENTS.md / REVIEW.md / `.github/workflows/` to `verifierFiles`; labeler should judge with base code; wait-preview polls every commit's check-runs and can burn the 1,000/hour GITHUB_TOKEN budget; verify-shots only grows.

Related: [[verify-in-actions-plan]], [[merge-requires-bot-review-pass]].
