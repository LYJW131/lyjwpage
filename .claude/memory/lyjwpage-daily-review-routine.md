---
name: lyjwpage-daily-review-routine
description: Daily 04:00 Asia/Shanghai routine that runs /code-review + /simplify on main since a cursor, opens a chore(review) PR and auto-merges it; state lives in issue #185
metadata:
  type: project
---

Created 2026-10-12 at lyjw's request. Routine `trig_01C9Jj2Ax3WUm4XxxEke67SY` ("lyjwpage 每日代码审查"), cron `CRON_TZ=Asia/Shanghai 0 4 * * *`, fires into the project thread "每日代码审查" session (private projects can't use fresh-session-per-fire routines). Dev branch `claude/project-thread-p8932i`, restarted from main each run.

**Cursor/state:** GitHub issue LYJW131/lyjwpage#185 body holds `reviewed` (last fully completed review, advanced only after merge / confirmed no-op) and `cursor` (stamped at run start). One comment per run = run record. Git tags can't be used: the session git proxy returns 403 on tag pushes.

**Authorization:** owner explicitly allowed auto-merge of the routine's own `chore(review):` PRs after all checks (check, claude-review, CodeQL, Workers Builds) are green and blocking review findings fixed.

**How to apply:** to change the routine, use update_trigger on that id; to see history, read issue #185. Practices it follows: [[agent-automation-practices]].
