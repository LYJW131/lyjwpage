---
name: tokens-ci-cloud-hook
description: Cloud sessions and project threads report token usage to tokens.ci via a user-level Stop hook installed by the env setup script (#636)
metadata:
  type: project
---

lyjw contributed Claude Code cloud support to missuo/tokens (PR #89). Project threads don't run repo hooks ([[thread-sessions-skip-repo-hooks]]), so since #636 (merged 2026-10-24 05:50 SGT) the tokens.ci Stop hook is user-level. Since #717 (2026-10-27) `scripts/cloud/tokens.sh` installs `tokens-cli` and merges the Stop hook into `~/.claude/settings.json` after `claude-user.sh`; the env Setup script is a thin shell that curls `scripts/cloud/setup.sh` (entry only). Verified in a thread that hooks in that file do fire. The Stop hook is async with `timeout 30`.

Credential: Network secret on <cloud env> (host `tokens.ci`, path `/api/submit`, Bearer), recorded in `docs/ops-facts.md`. Verified: placeholder-Bearer request went 401 → 400 after the secret was added.

**Pending:** confirm uploads from a new thread on tokens.ci (lyjw to check).

Earlier repo-level hook PRs: #626, #630 (superseded by the user-level hook in #636).
