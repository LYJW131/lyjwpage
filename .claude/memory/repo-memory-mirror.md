---
name: repo-memory-mirror
description: Retired 2026-11-25 after migrating from Claude Projects to T3 Code — .claude/memory/ is now the single source of truth for public project memory; local private notes live out-of-repo at ~/.agents/projects/lyjwpage.md
metadata:
  type: project
---

**Current state (since 2026-11-25, T3 Code migration):**
- `.claude/memory/` is now the **single source of truth** for public project memory — edit it directly in feature PRs or small `docs(memory):` PRs (merge once local `pnpm docs:check` passes, no CI/bot-review wait).
- The daily 03:15 `记忆镜像同步` routine and `/tmp/claude/memory/team/silo` dual-copy workflow are **permanently retired**.
- Local/private notes that must never enter the public repo (local machine handles, scheduled task IDs, local state paths, personal env notes) live out-of-repo at `~/.agents/projects/lyjwpage.md`.
- `scripts/memory-mirror.ts#findSecrets` remains useful as a secret-leak reference check before committing public memory changes.

---

**Historical context (Claude Projects era, 2026-10-13 – 2026-11-13):**
- Originally created in PR #231 so local Mac sessions, Codex and Devin could read Claude Projects' private cloud memory.
- Synced via `pnpm memory:mirror /tmp/claude/memory/team/silo` and daily 03:15 Sonnet routine (last mirror sync before migration: #806 on 2026-11-11 06:23 UTC+8).
- Secret-check principle still applies: never store usable secrets in memory; if a leak check false-positives on harmless variable names, fix the check rather than distorting memory wording (#629, #688).
