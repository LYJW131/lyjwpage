---
name: morning-report-routine
description: Daily 10:56 SGT morning report routine posted in thread「晨报 · 定时任务」, with hourly in-place updates until lyjw writes
metadata:
  type: project
---

Created 2026-10-20 01:54 SGT after lyjw found no morning report task ("我好像没看到这个定时任务"). The old "lyjw 晨报 9:00" was a one-shot send_later that fired once on 2026-10-14 and stopped, so there was no auto report from 10-15 on. lyjw moved it to 11:00 SGT ("定时任务改到11点吧 SGT"); cron is `CRON_TZ=Asia/Shanghai 56 10 * * *`.

Bound to the session of thread「晨报 · 定时任务」 (find the id with list_triggers), not the coordinator: the coordinator session gets replaced and the binding would break. The report is a `reply` in that thread, not a project-chat post.

Content: 要你做的 / 隔夜合并 / 失败与没读到 / Anthropic 动态 (only absorbable items). It reads list_project_prs, list_thread_sessions, #185, skill-mining runs/, superfan-collector/<date>.md, anthropic-updates/<date>.md. Then arms a one-shot +60 min; each fire edits the report in place unless lyjw has written in the project since; stops at 23:00 SGT. Read-only: no PRs, no merges.

Same session also did the 2026-10-20 prompt trim of the review / skill-mining / memory-mirror / collector routines (new texts kept in /mnt/project-files/routine-prompts/). Siblings: [[lyjwpage-daily-review-routine]], [[anthropic-updates-routine]], [[collector-superfan-routine]], [[skill-mining-routine]].
