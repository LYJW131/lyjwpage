---
name: pr-review-auto
description: Threads run skill lyjwpage-pr-review (own Devin swe-2-max reviewer in the cloud container) on their own before opening a big-change PR; lyjw never has to ask
metadata:
  type: feedback
---

lyjw 2026-10-26 19:20 SGT「不要让我说 让线程自动根据pr复杂度决定需不需要 就像自己把opus评审员叫出来一样」.

lyjw 2026-10-28 23:41 SGT「我感觉这个没有必要放在 Action 上跑，你直接在云端环境内部里面跑，然后替代掉之前那一个 Devin Loop 评审」: skill `lyjwpage-pr-review` (runs `agents/pr-review/run.ts` in the thread's container) replaces `lyjwpage-swe-loop` (#682, Theo's tstack sol-loop with Devin swe-2-max, multi-round). No GitHub Actions workflow, no `DEVIN_CREDENTIALS` secret.

Trigger = the same judgment as adding `needs-judge`: big change → run it before opening the PR, then label. Small changes, docs, skills: skip. If Devin can't start, the rate limit outlasts the wait, or no parsable result: note "评审员没跑成" and open the PR anyway. One run by default; at most one rerun when a high fix touched behavior code.

Old swe-loop data point (2026-10-26): on Clawd commit 912e031 it found all 3 bugs later fixed plus a real negative-index crash, ~9 + 2 min.

**How to apply:** at the big-change decision point, run the skill without asking lyjw. Related: [[pr-review-devin-reviewer]], [[merge-requires-bot-review-pass]], [[devin-free-tier-limit]].
