---
name: tokens-ci-cloud-hook
description: Cloud sessions and project threads report token usage to tokens.ci via a user-level Stop hook installed by the env setup script (#636)
metadata:
  type: project
---

lyjw contributed Claude Code cloud support to missuo/tokens (PR #89). Project threads don't run repo hooks ([[thread-sessions-skip-repo-hooks]]), so since #636 (merged 2026-10-24 05:50 SGT) the tokens.ci Stop hook lives in `scripts/cloud/claude-user-settings.json`; env <cloud env>'s Setup script (copy in `scripts/cloud/setup.sh`, lyjw added it 2026-10-24 05:56 SGT) installs `tokens-cli` and curls that json to `/root/.claude/settings.json`. Verified in a thread that hooks in that file do fire. The Stop hook is async with `timeout 30`.

Credential: Network secret on <cloud env> (host `tokens.ci`, path `/api/submit`, Bearer), recorded in `docs/ops-facts.md`. Verified: placeholder-Bearer request went 401 → 400 after the secret was added.

**Pending:** confirm uploads from a new thread on tokens.ci (lyjw to check).
