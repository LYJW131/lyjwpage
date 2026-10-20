---
name: explore-directions
description: lyjw allows trying different directions in lyjwpage; raise direction doubts early in the thread, close or reshape finished PRs without treating them as sunk cost
metadata:
  type: feedback
---

lyjw 2026-10-20 04:25 SGT, quoting the "When we change direction" section of [How the Claude Code team does code review](https://claude.dev/blog/solving-code-review-at-anthropic/): 「深得我心 我也允许在此项目中进行不同方向的探索」.

- Exploring different directions is allowed in this project. Agents make starting cheap, so some work should not land.
- When Claude sees a simpler route, a clash with an earlier decision, or doubts the work is worth doing, it says so early in the thread, not as a blocking review comment on a finished PR.
- A finished PR whose direction turns out wrong is closed or reshaped; that is not a loss. On close, write one line in the thread: why, and what replaced it.
- When lyjw raises a different direction, follow it; do not defend code already written.

**Why:** code is fast to write; late blocking wastes review rounds and lyjw's attention.

**How to apply:** written in HUMAN.md section 3「探索与换方向」. Does not change merge gates or what needs lyjw's OK ([[merge-requires-bot-review-pass]], [[design-md-ui-approval]]).
