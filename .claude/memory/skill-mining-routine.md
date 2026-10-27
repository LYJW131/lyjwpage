---
name: skill-mining-routine
description: Daily 04:53 Asia/Shanghai routine that mines project threads for reusable procedures and request drift (first ask vs final delivery), plus adopted Codex/Devin review findings on merged PRs, turning them into skills, checks/hooks, default-behavior fixes or memory lines via small PRs; feedback phase for the first 5 reports
metadata:
  type: project
---

Created 2026-10-13 at lyjw's request. Routine `trig_0177b6cgVarcfBLirk8qSXN2` ("lyjwpage 提炼 skill 与偏差复盘"), cron `CRON_TZ=Asia/Shanghai 53 4 * * *`, fires into the project thread "定时提炼可复用流程和 skill". Thin prompt: each run reads `origin/main:.claude/skills/lyjwpage-skill-mining/SKILL.md` and follows it.

**Drift review (lyjw, 2026-10-13):** compare each first ask with the final delivery. Step 5b of the skill: per finished ask, list drifts, decide "change a default" vs "ask earlier/better" vs "stop asking", apply up to 3 fixes per run. First manual pass the same day.

**Review-finding step (lyjw, 2026-10-14 21:58 SGT, project chat):** "去看合并的pr里 codex和devin的有效建议 看看能不能之后写的时候就先做好 用skill或者hook或者其它类似的约束". Step 4b + `review-mining.md` (#319): bookmark `prs.lastMergedAt`+`lastNumber`; since #437 `scripts/review-sieve.ts` sorts Codex/Devin findings into adopted (reply names a PR commit made after the suggestion) / uncertain / notAdopted, the lead reads only uncertain ones (no Sonnet PR readers); a class seen in 2+ PRs is moved up the ladder: ESLint / rules:check / hook in a separate `chore(checks):` PR (proved on the real old error, clean on main, merged on green), else a skill line, code-structure changes only proposed.

**State:** `/mnt/project-files/skill-mining/state.json` (per-thread bookmark = last message id read, ledger incl. `drift` items, feedback counters), one run record per run in `runs/<date>-<HHMM>.md`. Readers are Sonnet subagents (read-only fetch_thread); main thread judges and spot-checks quotes with fetch_messages.

**Authorization (lyjw, 2026-10-13):** the routine merges its own `docs(skills):` / `docs(agents):` PRs and step-4b `chore(checks):` PRs once CI is green. It may edit skills, its own SKILL.md and trigger prompt, and for drift fixes AGENTS.md「工作方式」, HUMAN.md and project memory (+ mirror). AGENTS.md 禁区/部署流程, merge gates, and anything loosening an approval or safety rule still need lyjw.

**Feedback phase:** every run replies in its thread and asks for lyjw's reaction until 5 reports are sent or lyjw says "磨合结束"; then it only replies when a PR merged or a decision is needed.

Practices: [[agent-automation-practices]]. Sibling routine: [[lyjwpage-daily-review-routine]]. Verification inside it: [[verification-haiku-worker]]. Hand-off fix from the first drift pass: [[handoff-carry-user-constraints]].

**Moved 2026-10-28 06:33 SGT** to a new thread/session and new trigger id (old signing key revoked); current ids and branch: [[routine-bindings]]. Ids above are the old, disabled ones.
