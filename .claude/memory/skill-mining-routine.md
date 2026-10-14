---
name: skill-mining-routine
description: Daily 04:53 Asia/Shanghai routine that mines project threads for reusable procedures and request drift (first ask vs final delivery), turning them into skills, default-behavior fixes or memory lines via small PRs; feedback phase for the first 5 reports
metadata:
  type: project
---

Created 2026-10-13 at lyjw's request ("定时扫讨论串 找可复用的流程或 skill，前几次持续收集反馈并不断改进"). Routine `trig_0177b6cgVarcfBLirk8qSXN2` ("lyjwpage 提炼 skill 与偏差复盘"), cron `CRON_TZ=Asia/Shanghai 53 4 * * *`, fires into the project thread "定时提炼可复用流程和 skill". Thin prompt: each run reads `origin/main:.claude/skills/lyjwpage-skill-mining/SKILL.md` and follows it.

**Drift review (lyjw, 2026-10-13 15:30Z, thread "需求偏差复盘并入例程"):** "去扫对话记录…看我第一次提需求…直到最后完成…中间有哪一些偏差…你看你是要更改你的默认执行方式，还是需要向我更多提问". Added as step 5b of the skill: per finished ask, list drifts, decide "change a default" vs "ask earlier/better" vs "stop asking", apply up to 3 fixes per run. First manual pass the same day.

**State:** `/mnt/project-files/skill-mining/state.json` (per-thread bookmark = last message id read, ledger incl. `drift` items, feedback counters), one run record per run in `runs/<date>-<HHMM>.md`. Readers are Sonnet subagents (read-only fetch_thread); main thread judges and spot-checks quotes with fetch_messages.

**Authorization (lyjw, 2026-10-13):** the routine merges its own `docs(skills):` / `docs(agents):` PRs once CI is green. It may edit skills, its own SKILL.md and trigger prompt, and for drift fixes AGENTS.md「工作方式」, HUMAN.md and project memory (+ mirror). AGENTS.md 禁区/部署流程, merge gates, and anything loosening an approval or safety rule still need lyjw.

**Feedback phase:** every run replies in its thread and asks for lyjw's reaction until 5 reports are sent or lyjw says "磨合结束"; then it only replies when a PR merged or a decision is needed.

Practices: [[agent-automation-practices]]. Sibling routine: [[lyjwpage-daily-review-routine]]. Verification inside it: [[verification-haiku-worker]]. Hand-off fix from the first drift pass: [[handoff-carry-user-constraints]].
