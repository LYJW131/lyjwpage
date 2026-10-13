---
name: push-to-merge-authorizes-merge
description: lyjw saying 推进到合并 (or tapping a card whose consequence says 一路推进到合并) authorizes merging every PR of that task; don't ask again for 合
metadata:
  type: feedback
---

When lyjw approves a task with 「推进到合并」/「推进到合并进main」, or taps a decision-card option whose consequence says 「一路推进到合并」, that already authorizes merging each PR of that task once CI is green and every bot review is handled ([[pr-merge-bot-reviews]]). Do not ask for a separate 「合」 per PR.

**Why:** 2026-10-13, after the Apple Music → collector thread asked him to say 合 for PR #210, he replied: "我之前说的是 好 统一走站点 推进到合并 为什么还问我". HUMAN.md (PR #208) only listed 「合」「完了直接合」「ci 过了直接合」 as merge authorization, which made threads ask again.

**How to apply:** treat these phrases like 「完了直接合」 for the PRs of the task they were said about (a follow-up PR in the same series counts). Still ask for anything production-side or destructive that the phrase doesn't name (secret deletion, Workers Builds rebuilds, console settings), e.g. api's Apple key in [[apple-music-to-collector]]. HUMAN.md's merge-authorization line should say the same ([[human-md-collaboration-guide]]).
