---
name: repo-memory-mirror
description: Project memory is mirrored into the repo at .claude/memory/ (PR #231); every memory change gets synced there in the same turn via a small docs PR
metadata:
  type: feedback
---

lyjw (2026-10-13): "你的项目记忆 除了在claude code projects里维护 同时也在仓库里维护一个记忆目录吧". PR #231 added `.claude/memory/` (MEMORY.md index + one file per topic, same names), a README with sync and redaction rules, and pointers in AGENTS.md and HUMAN.md. `scripts/docs-check.mjs#MEMORY_MIRROR_DIR` skips the directory (memory lines carry dates).

**Why:** the owner wants memory visible in the repo with git history.

**How to apply:** whenever you add, edit or delete a project memory file, copy the change into `.claude/memory/` in the same turn (drop the `modified:` line, private claude.ai links, cloud env / session IDs, any secret value), and open a small docs PR or ride an open PR; merge once CI is green, no bot-review wait.
