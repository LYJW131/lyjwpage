---
name: build-actions-migration
description: Issue #173 visitor build moved from claude.ai routine to GitHub Actions; fully cut over 2026-10-13 (old routine deleted, ROUTINE_FIRE_* secrets deleted)
metadata:
  type: project
---

Issue #173: user chose to ship phase 1 (plan review gate) and phase 2 (implementation in GitHub Actions) together. PR #200 (merged 2026-10-13) added .github/workflows/build.yml (review → gate → implement → publish), scripts/build-actions.mjs and the Worker's OIDC auth (workers/ai/src/build/actions-oidc.ts). The Worker stays the only validator and committer. PR #204 binds the OIDC audience to `${callbackOrigin}/builds/${runId}`. Build flow verified end-to-end in production (#239, #242).

**Cutover done 2026-10-13:** the user deleted the claude.ai routine "lyjwpage /build" (trig_014sUCU54BW4Bd39UmcWjLK6) themselves. The test routine trig_01D64vPhffksi2pfXDPHzRPp is also not found. ai Worker secrets ROUTINE_FIRE_URL / ROUTINE_FIRE_TOKEN were deleted by name via the Cloudflare MCP; no branch preview had them. docs/ops-facts.md and docs/build-routine.md were updated, pushed straight to main at the user's request. The claude.ai environments <cloud env> and <cloud env> still exist, unused.

**Gotcha:** cloud auto mode blocked the Cloudflare secret DELETE after a vague "删了吧". It went through once the user typed an explicit sentence in the thread naming the Worker and both secrets.

Related, but kept separate: the daily post-merge review [[lyjwpage-daily-review-routine]].
