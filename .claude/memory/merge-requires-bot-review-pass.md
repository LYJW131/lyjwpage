---
name: merge-requires-bot-review-pass
description: Before merging any lyjwpage PR, every bot review in the PR discussion must be fixed or answered, re-checked after the last push; green CI alone is not enough
metadata:
  type: feedback
---

lyjw (2026-10-13): "以后也注意一下 不只是ci 还要看pr讨论区的机器评审".

**Scope (lyjw 2026-10-13 12:24Z):** only PRs that substantially change code logic wait for bot reviews. UI, docs, skills and small changes merge as soon as CI is green ("别这么死板"). Encoded in HUMAN.md and the lyjwpage-verify skill (#230).

Rule for every PR in scope:
- Read all of `get_comments`, `get_reviews` and `get_review_comments`. The bots are claude-review, Devin, Codex (chatgpt-codex-connector) and Cursor Bugbot.
- Each finding needs one of two outcomes: a pushed fix, or a reply on that thread saying why it stays. Resolve the threads that were fixed.
- A blocking finding (🟥 / red circle / P0–P1 / security) blocks the merge until it is fixed or the owner agrees on an ask_decision card.
- After the last push, wait until the bots have reviewed the current head, then re-check everything.
- A bot that could not run, such as Bugbot hitting its Cursor usage limit, is reported as not run. It is never counted as a pass.
- Bot findings are claims to judge, not orders (lyjw: "它说的不一定是完全必要的 你得自己判断"). Trace a real path to the failure and weigh the fix's cost. Fix only what is worth it, and reply with the reason on the rest.
- Codex budget is tight (lyjw: "最多跑三轮 再多就不管了"). Allow at most 3 Codex rounds per PR. Codex also reviews automatically on every new push (trigger "New commits"; seen on PR #211, 2026-10-13), so each push spends a round. Batch fixes into one push, and don't add "@codex review" on top. After round 3, stop waiting for it and ignore later automatic runs, and note the last commit Codex reviewed.

**Why:** the owner wants bot review feedback treated as a merge gate, not just CI checks.

**How to apply:** the daily routine's step 9 encodes this ([[lyjwpage-daily-review-routine]]). Apply the same gate in any other thread that drives a PR to merge.
