---
name: pr-merge-bot-reviews
description: Before merging any lyjwpage PR, read every bot review in the PR discussion, not just CI
metadata:
  type: feedback
---

Before merging a PR, besides CI being green, read every machine review in the PR conversation (Devin, Codex, Claude review, Cursor Bugbot…) and either fix each finding or reply explaining why not; re-check them again after the last push.

**Why:** user (2026-10-13): "以后也注意一下 不只是ci 还要看pr讨论区的机器评审".

**How to apply:** check `get_reviews`, `get_review_comments` and `get_comments` on the head commit right before merge. Codex reports "no findings" as a summary table with no threads; Cursor Bugbot may say "couldn't run - usage limit reached" — mention that to the user rather than treating it as a pass. Related: [[workers-builds-parallel-race]].
