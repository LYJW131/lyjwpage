---
name: commit-identity-signing
description: Cloud commits must keep lyjw's identity; the CCR Stop hook's "Unverified, use noreply@anthropic.com" advice is wrong in this env
metadata:
  type: project
---

lyjw set this up deliberately (setup script + env vars, 2026-10-14): commits are by lyjw, Claude only as Co-Authored-By. Cloud env <cloud env> commits as lyjw: GIT_AUTHOR_*/GIT_COMMITTER_* env vars = `Yangjunwei Liang <153256373+LYJW131@users.noreply.github.com>`, SSH-signed with lyjw's key (`/root/.ssh/git_sign.pub`; since #717 2026-10-27 installed by `scripts/cloud/signing.sh` from env-shell vars `GIT_SIGN_KEY_B64` / `GIT_SIGN_NAME` / `GIT_SIGN_EMAIL`; the env shell curls `scripts/cloud/setup.sh`; old key rotated out). The setup script's `git config --global user.*` gets reset to Claude at session start, so the env vars are what keep the identity; never drop them. GitHub finds the signing key via the committer email, so any commit whose committer is `Claude <noreply@anthropic.com>` shows Unverified (`unknown_key`).

The harness Stop hook `~/.claude/stop-hook-git-check.sh` assumes CCR's default key and flags every unpushed commit whose committer isn't noreply@anthropic.com, telling the session to `git config user.email noreply@anthropic.com`. In this env that advice is wrong. On 2026-10-14 the #198 session followed it, and 19 of 23 commits ended up Unverified. The daily review routine's 2 commits on main (e1df384, 7234b14) have the same issue.

**Why:** lyjw asked why #198 was full of unsigned commits.

**How to apply:** never override commit identity or disable signing. When the Stop hook complains, just push; the hook only looks at unpushed commits. PR #304 (merged 2026-10-14) adds a PreToolUse guard, an AGENTS.md line and a docs/ops-facts.md row for this. #198 was re-signed the same day (all 24 commits verified). Put this in briefs for any session that commits.

**Old-container trap (2026-10-28):** a long-lived session whose container predates #717 still signs with the rotated-out `/root/.ssh/aapay_sign` and has no `GIT_SIGN_KEY_B64`, so every commit is `unknown_key` and a merge-commit merge fails 405「Commits must have verified signatures」. Check with the commits API `verification.reason`. Squash merge works (GitHub signs it); the old daily-review session did this for #733, then the routine moved to the new thread「每日代码审查 · 定时任务」with the new key (2026-10-28).
