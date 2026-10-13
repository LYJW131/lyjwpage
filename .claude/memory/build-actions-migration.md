---
name: build-actions-migration
description: Issue #173 visitor build moved from claude.ai routine to GitHub Actions (PR #200, opened 2026-10-12); pending post-merge cutover steps
metadata:
  type: project
---

Issue #173: user chose to ship phase 1 (plan review gate) and phase 2 (implementation in GitHub Actions) together. PR #200 (merged 2026-10-13) added .github/workflows/build.yml (review → gate → implement → publish), scripts/build-actions.mjs and the Worker's OIDC auth (workers/ai/src/build/actions-oidc.ts). The Worker stays the only validator and committer.

**Why:** a real runner run is only possible after merge, because repository_dispatch runs the default-branch workflow and OIDC accepts only main's build.yml.

**How to apply:** PR #200 merged 2026-10-13. PR #204 (merged 2026-10-13, 5e077b49, deployed) binds the OIDC audience to `${callbackOrigin}/builds/${runId}` and makes job_workflow_ref optional; the real build acceptance was gated on it and is now unblocked. Remaining, in order: confirm the Actions secret CLAUDE_CODE_OAUTH_TOKEN exists and the GitHub App has Contents write. Then run one real build to accept it. After the first production success, disable claude.ai routine trig_014sUCU54BW4Bd39UmcWjLK6 ("lyjwpage /build"). Delete the ai Worker secrets ROUTINE_FIRE_URL and ROUTINE_FIRE_TOKEN (prod and previews) in a Remote Control session, per [[credentials-pipe-only]]. Then update docs/ops-facts.md. Don't rebase that branch after push: docs/architecture.json revision pins commit af504d82.

Related, but kept separate: the daily post-merge review [[lyjwpage-daily-review-routine]].
