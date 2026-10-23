---
name: claude-review-hollow
description: Why the official claude-code-review always said "No issues found" and the fix (Opus as orchestrator), found 2026-10-23 on PR #572
metadata:
  type: project
---

lyjw asked (2026-10-23) why the official `claude-code-review.yml` review always says "No issues found".

Evidence: with `show_full_output: true` (#570), the #572 review log (run 39923367701) showed the default model, Sonnet 5.5, acting as orchestrator. It made no Task calls (the code-review plugin expects it to dispatch Haiku/Sonnet/Opus subagents), read 1–2 files itself, ran 10 turns for $0.186, and concluded "No issues found". The Task tool was available.

Fix in #572: `claude_args: --model opus` on that workflow. The review only fires on PR opened / ready_for_review, so the fix is first exercised on the next new PR after #572 merges. Check that run's full output for Task calls and real findings before calling it fixed.

Related: [[verify-in-actions-plan]], [[merge-requires-bot-review-pass]].
