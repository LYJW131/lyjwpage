---
name: swe-2max-dispatch
description: How to dispatch SWE-2Max (Devin CLI) tasks on lyjw's Mac and review their output
metadata:
  type: reference
---

**SWE-2Max (Devin CLI, Mac only):** dispatch via Mac Remote Control threads, one worktree per task, `cd <path> && devin -p --model swe-2-max --respect-workspace-trust false --permission-mode dangerous --prompt-file task.md --export log.md`, in parallel; Claude reviews the diff and opens the PR. Forbid `git stash`. If blocked, start a fresh Mac session. lyjw wants it kept busy.
