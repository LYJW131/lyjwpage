---
name: merge-ci-wait-tiers
description: Which PRs wait for GitHub CI before merge: only big logic changes; docs and small fixes merge after local checks (lyjw 2026-10-20)
metadata:
  type: feedback
---

Docs, skills, docs/references.md and the memory mirror merge as soon as local `pnpm docs:check` passes. Clear fixes and small changes merge once the local checks for the touched areas pass (related tests, typecheck, eslint). Neither waits for the GitHub Actions queue; if CI goes red afterwards, fix it at once. Big logic changes still need CI green plus bot review; UI/UX changes still need lyjw's OK unless lyjw asked for the small change.

**Why:** lyjw 2026-10-20 05:20 SGT replied 「行」 to the skill-mining thread's proposal, after saying 「直接推main」 three times (Anthropic updates, Exa 3.0, formal-verification threads) and 「直接合 明确修复+小改动不用问」. The Actions queue stalled 15+ min and 35 jobs deep in two threads while local gates passed. Workers Builds deploys main regardless of CI, so the local check is the real guard.

**How to apply:** run the checks the change touches before merging; in `pr-gate.ts` output, `checks.pending` does not block these tiers but `failing` must be fixed. Cloud push to main is refused by the proxy, so open the PR, resolve threads, merge at once. Written into HUMAN.md §5 (#474). Related: [[push-to-merge-authorizes-merge]], [[merge-requires-bot-review-pass]].
