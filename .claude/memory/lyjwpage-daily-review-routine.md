---
name: lyjwpage-daily-review-routine
description: Daily 04:00 Asia/Shanghai routine that runs /code-review + /simplify on main since a cursor, opens a chore(review) PR and auto-merges it; state lives in issue #185
metadata:
  type: project
---

Created 2026-10-12 at lyjw's request. Routine `trig_01C9Jj2Ax3WUm4XxxEke67SY` ("lyjwpage 每日代码审查"), cron `CRON_TZ=Asia/Shanghai 0 4 * * *`, fires into the project thread "每日代码审查" session (private projects can't use fresh-session-per-fire routines). Dev branch `claude/project-thread-p8932i`, restarted from main each run.

**Cursor/state:** GitHub issue LYJW131/lyjwpage#185 body holds `reviewed` (last fully completed review, advanced only after merge / confirmed no-op) and `cursor` (stamped at run start). One comment per run = run record. Git tags can't be used: the session git proxy returns 403 on tag pushes.

**Authorization:** lyjw explicitly allowed auto-merge of the routine's own `chore(review):` PRs after all checks (check, claude-review, CodeQL, Workers Builds) are green and blocking review findings fixed.

**Merge gate (prompt step 9, synced to HUMAN.md 2026-10-14):** bot reviews only for real logic changes; Codex auto-reviews every push, max 3 rounds, no `@codex review`; Bugbot out of quota is ignored; all review threads resolved; UI-visible changes need lyjw's OK; merge with `pnpm merge-message` output ([[merge-commit-format]], [[merge-requires-bot-review-pass]]).

**Gardener (step 6b, added 2026-10-14 from the poteto list, lyjw OK'd):** each run looks for bad patterns being copied (2+ places repo-wide) and spot-checks up to 2 merged logic PRs; findings go as comments into buffer issue #280 and are only logged Tuesday to Sunday. On Mondays (Shanghai) it batch-processes #280: add an eslint / rules-check guard proven against a real old occurrence, add a row to AGENTS.md「规则 → 由什么强制」, clean up occurrences, reply「已处理：#PR」. Run record gets a「园丁」line.

**返工账 (added to step 6b 2026-10-16 SGT from magpie's LESSONS.md, lyjw picked it):** each run also lists fix/revert commits in range that repair something another PR merged within the previous 2 days, logs each to #280 with first line `返工：<类别>`; a class seen on 3 different dates is promoted on Monday like other gardener findings. First run looks only at its normal range. Since #437 (prompt updated 2026-10-20 01:11 SGT, only editable from the routine's own session) the step first runs `node scripts/rework-candidates.ts --from BASE --to NEW` (git blame pairs); the model only names categories, merges fix-of-fix chains and glances at fixes without candidates.

**How to apply:** to change the routine, use update_trigger on that id; to see history, read issue #185. Practices it follows: [[agent-automation-practices]].

**Delegation (2026-10-23 06:40 SGT, lyjw「处理定时任务吧」):** prompt section「## 分工」: steps 5–7 (review, simplify, gardener, apply + verify) go to an opus high reviewer subagent that commits but does not push; the persistent session keeps state, PR, merge gate and bookkeeping. Prompt text mirrored at /mnt/project-files/routine-prompts/daily-review.txt. See [[token-efficiency-review]].

**Moved 2026-10-28 06:33 SGT** to a new thread/session and new trigger id (old signing key revoked); current ids and branch: [[routine-bindings]]. Ids above are the old, disabled ones.

**CodeQL (lyjw 2026-10-29「交给项目自身巡检任务每次看一眼codeql」):** prompt step 2b reads the latest lyjw131[bot] comment on standing issue #763「CodeQL 告警」(label `Automation`, comments posted by `.github/workflows/codeql-alerts.yml` only when the open set changes; cloud gets 403 on the alerts API) and checks the latest sync run is success and under 36h; small real fixes go to the reviewer (step 6c) in the review PR, whose body says `Refs #763`; the rest into「需要你决定」; run record gets a「CodeQL」line. See [[codeql-policy]].
