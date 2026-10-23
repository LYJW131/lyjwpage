---
name: claude-review-hollow
description: Why the official claude-code-review said "No issues found" (upstream #100401, Sonnet orchestrator skips agents) and the fix (Opus orchestrator, #577), found 2026-10-23
metadata:
  type: project
---

lyjw asked (2026-10-23) why the official `claude-code-review.yml` review always says "No issues found".

Cause: upstream bug [anthropics/claude-code#100401](https://github.com/anthropics/claude-code/issues/100401) (open). Since Claude Code 2.1.285 (action v1.0.237+), the code-review plugin under the default Sonnet 5.5 skips its subagents and still posts "No issues found". Our own workflow customizations are not the cause.

Evidence: with `show_full_output: true` (#570), run 39923367701 on #572 showed Sonnet reading 1–2 files itself, no Agent calls, $0.19. Baseline test PR #573: 0 Agent calls, $0.13, 28 s.

Fix: #577 (merged) sets `--model opus` and allows `Task,Agent` in `claude_args`. Test PR #578 (one planted bug): Opus ran the eligibility subagent, then reviewed the 1-line diff itself, ran the tests and posted 2 correct inline findings ($0.44, 55 s). Multi-file test #580 checks larger diffs.

Cost (2026-10-23): on multi-file #580 Opus ran the full plugin flow, 8 subagents, $1.23, 2 min. lyjw: too heavy for every PR (「不适合每个pr都跑」). #583 (merged) gates the review on `scripts/pr-gate/tier.ts#tierOf` `judge` (logic tier or non-lyjw author); docs test #584 confirmed the skip.

Testing trap: with the Claude App token (no `github_token`), claude-code-action skips the run when the workflow file differs from main ("Workflow validation failed"). So a review-workflow change can only be tested after it merges; test PRs #574–576 were skipped this way. Passing `github_token` to bypass it was refused by auto mode; don't retry.

Related: [[verify-in-actions-plan]], [[merge-requires-bot-review-pass]].
