---
name: routine-bindings
description: Active T3 Code scheduled tasks for lyjwpage (since 2026-11-25) and archived historical Claude Projects routine bindings
metadata:
  type: project
---

## Current bindings (T3 Code `schedule_task`, since 2026-11-25)

All active routines run on lyjw's local desktop T3 Code instance in the `lyjwpage` project with `freshSession: true` (each routine shares one dedicated thread while starting every run with a clean provider session — no context bloat). State lives outside the git repo under `~/.local/state/lyjwpage-routines/`.

| Task | Schedule (UTC+8) | State directory | Notes |
| --- | --- | --- | --- |
| `lyjwpage · collector 盯防` | Every 12h (2x/day) | `~/.local/state/lyjwpage-routines/superfan-collector/` | Uses local `cf` OAuth telemetry runner; 1-line fast exit when all green; at most 1 draft fix PR per run in an isolated temp worktree |
| `lyjwpage · 提炼 skill 与偏差复盘` | Mon & Thu 04:53 | `~/.local/state/lyjwpage-routines/skill-mining/` | Scans T3 threads (`t3_thread_list/read`) + `scripts/review-sieve.ts`; fast exit when no new activity; warm-up opens PRs for lyjw review |

- **Not currently enabled**: `Anthropic 官方动态`, `每日代码审查`, `晨报` (enable only when lyjw asks).
- **Permanently retired**: `03:15 记忆镜像同步` (`.claude/memory/` is now single source of truth).
- Exact local T3 task IDs and environment handles are kept out-of-repo in `~/.agents/projects/lyjwpage.md`.

Related: [[collector-superfan-routine]], [[skill-mining-routine]], [[lyjwpage-daily-review-routine]], [[anthropic-updates-routine]], [[morning-report-routine]], [[repo-memory-mirror]].

---

## Historical archive (Claude Projects era, 2026-10-12 – 2026-11-13, all disabled)

On 2026-10-28 06:33 SGT all six Claude Projects routines moved to fresh signing-key sessions; on 2026-11-11 02:44 SGT lyjw paused all except `08:41 Anthropic 动态`; all cloud triggers ended when the Anthropic org was disabled on 2026-11-13.
