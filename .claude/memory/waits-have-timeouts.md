---
name: waits-have-timeouts
description: Every wait (CI, bot review, deploy, background loops) has an upper bound; on timeout record a failure and move on
metadata:
  type: feedback
---

On 2026-10-14 a thread looked stuck "waiting on CI and deploy" for about 45 minutes. The cause was a background `until` loop polling `gh run list --commit` with a mistyped SHA and no timeout, so it could never finish, although CI and the deploy had both succeeded within minutes. User: "以后要加超时 不能卡死".

**Why:** a condition that can never become true (typo'd SHA, cancelled or superseded run, review that never triggers) silently freezes the thread.
**How to apply:** wrap every hand-written wait in `timeout <s>` or a counter: 15 min for CI, Workers Builds and bot reviews; use `scripts/deploy-check.mjs --timeout` for deploys. Before looping, confirm the target exists (full SHA from `git rev-parse`, the run shows up in `gh run list`). On timeout, record FAIL with the last seen state and continue with the next independent step. Rule lives in `.claude/skills/lyjwpage-verify/SKILL.md`「等待要有上限」 and a pointer in root AGENTS.md「工作方式」.
