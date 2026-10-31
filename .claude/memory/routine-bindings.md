---
name: routine-bindings
description: Which scheduled task fires into which thread/session and dev branch; all six moved to new threads 2026-10-28 06:33 SGT after the old signing key was revoked
metadata:
  type: project
---

On 2026-10-28 06:33 SGT lyjw said the git signing key in the old routine threads was revoked, so commits from them can't be signed (「要全部换新讨论串」, then「一起搬」for the read-only ones too). All six routines got new threads in env `<internal id>` (new key; a probe commit showed GitHub `verified`). New scheduled tasks were created bound to the new sessions; the old ones are disabled and renamed「（旧会话，已停用）」, not deleted, so their run history stays.

| Task | New trigger | Session | Dev branch |
| --- | --- | --- | --- |
| 03:15 记忆镜像 | trig_01EZP65L8QzjaUStW6LiBNqg | <internal id> | claude/project-thread-5na815 |
| 04:00 每日代码审查 | trig_01Y63zeevgM9WrbfPiiMJjME | <internal id> | claude/project-thread-ad7fko |
| 04:53 提炼 skill | trig_018sXEhV49fp6Dx7pGmZv7tj | <internal id> | claude/project-thread-7qd9r1 |
| 08:41 Anthropic 动态 | trig_01Gcggmwjp47CkUAjJ1ZxvrV | <internal id> | claude/project-thread-rv1hl8 |
| 08:56 晨报 | trig_01ST7To5uAf2VeYQxbPUdEif | <internal id> | claude/project-thread-ekg06b |
| 01/07/13/19:53 collector 盯防 | trig_016btcofbs6YSrdCEkAEevoV | <internal id> | claude/project-thread-f4fz9c |

Thread titles are「<任务> · 定时任务」. Prompt texts (with the new branch names) are in /mnt/project-files/routine-prompts/.

**How to move a routine again:** update_trigger cannot change the bound session. Ask the coordinator for a new thread, read its session id and designated branch (get_session → outcomes.branches), create_trigger with persistent_session_id and the same prompt (swap branch names), read back with list_triggers, then disable and rename the old trigger. Anthropic 动态 needs the LYJW MCP Portal connector in the new session ([[x-mcp-portal]]).

Related: [[commit-identity-signing]], [[lyjwpage-daily-review-routine]], [[skill-mining-routine]], [[anthropic-updates-routine]], [[morning-report-routine]], [[collector-superfan-routine]], [[repo-memory-mirror]].
