---
name: skill-mining-routine
description: Daily 04:53 Asia/Shanghai routine that mines project threads for reusable procedures and turns them into .claude/skills via small docs(skills) PRs; feedback phase for the first 5 reports
metadata:
  type: project
---

Created 2026-10-13 at lyjw's request ("定时扫讨论串 找可复用的流程或 skill，前几次持续收集反馈并不断改进"). Routine `trig_0177b6cgVarcfBLirk8qSXN2` ("lyjwpage 提炼 skill"), cron `CRON_TZ=Asia/Shanghai 53 4 * * *`, fires into the project thread "定时提炼可复用流程和 skill". Thin prompt: each run reads `origin/main:.claude/skills/lyjwpage-skill-mining/SKILL.md` and follows it.

**State:** `/mnt/project-files/skill-mining/state.json` (per-thread bookmark = last message id read, candidate ledger, feedback counters), one run record per run in `runs/<date>-<HHMM>.md`. Readers are Sonnet subagents (read-only fetch_thread); main thread judges and spot-checks quotes with fetch_messages.

**Authorization (user, 2026-10-13):** the routine merges its own `docs(skills):` PRs (only `.claude/skills/**` + one pointer line) once CI is green, and during the feedback phase may edit its skills, its own SKILL.md, and its own trigger prompt (update_trigger). AGENTS.md hard rules and memory rules still need the user.

**Feedback phase:** every run replies in its thread and asks for the user's reaction until 5 reports are sent or the user says "磨合结束"; then it only replies when a PR merged or a decision is needed.

Practices: [[agent-automation-practices]]. Sibling routine: [[lyjwpage-daily-review-routine]]. Verification inside it: [[verification-haiku-worker]].
