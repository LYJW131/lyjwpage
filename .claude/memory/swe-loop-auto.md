---
name: swe-loop-auto
description: Threads run skill lyjwpage-swe-loop (Devin swe-2-max read-only review loop) on their own before opening a big-change PR; lyjw never has to ask
metadata:
  type: feedback
---

lyjw 2026-10-26 19:20 SGT「不要让我说 让线程自动根据pr复杂度决定需不需要 就像自己把opus评审员叫出来一样」.

Skill `lyjwpage-swe-loop` (#682, from Theo's tstack sol-loop, reviewer swapped to Devin's free swe-2-max). Trigger = the same judgment as adding `needs-judge`: big change → run swe-loop before opening the PR, then label. Small changes, docs, skills: skip. If Devin can't start or the rate limit outlasts the timeout, note "swe-loop 没跑成" and open the PR anyway (#684).

Test 2026-10-26: on Clawd commit 912e031 it found all 3 bugs later fixed (one graded nit, so Claude re-grades) plus a real negative-index crash; round 2 on the fixed head APPROVE. ~9 + 2 min.

**How to apply:** at the big-change decision point, run the skill without asking lyjw. Related: [[merge-requires-bot-review-pass]], [[devin-free-tier-limit]].
