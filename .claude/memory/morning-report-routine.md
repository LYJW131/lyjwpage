---
name: morning-report-routine
description: Daily 08:56 SGT morning report routine posted in thread「晨报 · 定时任务」, once a day, no follow-up updates
metadata:
  type: project
---

Created 2026-10-20 01:54 SGT after lyjw found no morning report task ("我好像没看到这个定时任务"). The old "lyjw 晨报 9:00" was a one-shot send_later that fired once on 2026-10-14 and stopped, so there was no auto report from 10-15 on. lyjw moved it to 11:00 SGT ("定时任务改到11点吧 SGT"); Moved to 09:00 SGT on 2026-10-31 (lyjw「把以后每天晨报改到 9 点」); cron is now `CRON_TZ=Asia/Shanghai 56 8 * * *`, header「晨报 · <MM-DD> 09:00 (SGT)」.

Bound to the session of thread「晨报 · 定时任务」 (find the id with list_triggers), not the coordinator: the coordinator session gets replaced and the binding would break. The report is a `reply` in that thread, not a project-chat post.

Content: 要你做的 / 隔夜合并 / 失败与没读到 / Anthropic 动态 (only absorbable items). It reads GitHub search_pull_requests, hearthbot list_threads/read_thread (tool names renamed 2026-10-28; old fetch_thread/list_thread_sessions/list_project_prs no longer exist), #185, skill-mining runs/, superfan-collector/<date>.md, anthropic-updates/<date>.md. One post per day, no hourly in-place updates (lyjw 2026-10-20 01:57 SGT: "在这里的话 就不用我不开口就更新了 就11点一次就行"). Read-only: no PRs, no merges.

Same session also did the 2026-10-20 prompt trim of the review / skill-mining / memory-mirror / collector routines (new texts kept in /mnt/project-files/routine-prompts/). Siblings: [[lyjwpage-daily-review-routine]], [[anthropic-updates-routine]], [[collector-superfan-routine]], [[skill-mining-routine]].

Since 2026-10-23 06:38 SGT (lyjw「处理定时任务吧」, thread「Token 效率复盘」) the prompt has the session dispatch a Sonnet medium worker that reads everything and drafts the report; the session only re-checks listed PRs and posts. Prompt text: /mnt/project-files/routine-prompts/morning-report.txt. See [[token-efficiency-review]].

**Moved 2026-10-28 06:33 SGT** to a new thread/session and new trigger id (old signing key revoked); current ids and branch: [[routine-bindings]]. Ids above are the old, disabled ones.

Rules from lyjw (2026-10-28/30): when lyjw asks for the report early, send it then and skip that day's scheduled fire (one per day, state.json lastSentAt is the guard). The 03:15 memory mirror writes no result file; a merged `docs(memory)` PR (or none = no change) is its result, never「没读到」. Security-type pending questions are ignored for now. PlayStation reporter gaps are the dorm router's split routing; don't chase them.
