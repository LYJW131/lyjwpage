---
name: repo-memory-mirror
description: Project memory is mirrored into the repo at .claude/memory/ (PR #231); every memory change gets synced there in the same turn via a small docs PR
metadata:
  type: feedback
---

lyjw (2026-10-13): "你的项目记忆 除了在claude code projects里维护 同时也在仓库里维护一个记忆目录吧". PR #231 added `.claude/memory/` (MEMORY.md index + one file per topic, same names), a README with sync and redaction rules, and pointers in AGENTS.md and HUMAN.md. `scripts/docs-check.ts#MEMORY_MIRROR_DIR` skips the directory (memory lines carry dates).

**Why:** lyjw wants memory visible in the repo with git history.

**How to apply:** whenever you add, edit or delete a project memory file, copy the change into `.claude/memory/` in the same turn (drop the `modified:` line, private claude.ai links, cloud env / session IDs, any secret value), and open a small docs PR or ride an open PR; merge it as soon as it is open (after local `pnpm docs:check` and the mirror test), without waiting for CI or bot review. lyjw 2026-10-20 11:34 SGT in this thread: 「记忆镜像 PR 不等 CI 直接合」 (see [[merge-ci-wait-tiers]]).

**Tooling (merged #231 as 8eb385c):** sync only with `pnpm memory:mirror /tmp/claude/memory/team/silo` (auto-redacts, aborts on secret-like text; never hand-copy). Daily routine `trig_01FZFVexAhcFPCXrEXf6tn1y` "lyjwpage 记忆镜像同步" at `CRON_TZ=Asia/Shanghai 15 3 * * *` fires into the thread "项目记忆仓库镜像"; that session delegates to a Sonnet 5.5 medium-effort Agent worker (lyjw asked for that model/effort) that runs the script, opens a `docs(memory):` PR and merges it right away without waiting for CI.
