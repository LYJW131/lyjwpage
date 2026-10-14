---
name: merge-requires-bot-review-pass
description: Bot-review merge gate for lyjwpage PRs that substantially change code logic (UI, docs, skills, small changes skip it): fix or answer every bot finding, re-check after the last push
metadata:
  type: feedback
---

lyjw (2026-10-13): "以后也注意一下 不只是ci 还要看pr讨论区的机器评审".

**Scope (lyjw 2026-10-13 12:24Z):** only PRs that substantially change code logic wait for bot reviews. UI, docs, skills and small changes merge as soon as CI is green ("别这么死板"). Encoded in HUMAN.md and the lyjwpage-verify skill (#230).

Rule for every PR in scope:
- Read all of `get_comments`, `get_reviews` and `get_review_comments`. The bots are claude-review, Devin, Codex (chatgpt-codex-connector) and Cursor Bugbot.
- Each finding needs one of two outcomes: a pushed fix, or a reply on that thread saying why it stays. Resolve the threads that were fixed.
- A blocking finding (🟥 / red circle / P0–P1 / security) blocks the merge until it is fixed or lyjw agrees on an ask_decision card.
- After the last push, wait until the bots have reviewed the current head, then re-check everything.
- Some bots post only after ready_for_review (PR #200 merged with two Devin threads posted 2 min after it went ready). Codex reports "no findings" as a summary table with no threads.
- Cursor Bugbot is turned off (out of quota, lyjw 2026-10-13 17:39Z): don't wait for it or mention it. Any other bot that could not run is reported as not run, never counted as a pass.
- Bot findings are claims to judge, not orders (lyjw: "它说的不一定是完全必要的 你得自己判断"). Trace a real path to the failure and weigh the fix's cost. Fix only what is worth it, and reply with the reason on the rest.
- Codex budget is tight (lyjw: "最多跑三轮 再多就不管了"). Allow at most 3 Codex rounds per PR. Codex also reviews automatically on every new push (trigger "New commits"; seen on PR #211, 2026-10-13), so each push spends a round. Batch fixes into one push, and don't add "@codex review" on top. After round 3, stop waiting for it and ignore later automatic runs, and note the last commit Codex reviewed.

**Why:** lyjw wants bot review feedback treated as a merge gate, not just CI checks.

**How to apply:** the daily routine's step 9 encodes this ([[lyjwpage-daily-review-routine]]). Apply the same gate in any other thread that drives a PR to merge.
