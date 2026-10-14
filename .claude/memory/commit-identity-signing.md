---
name: commit-identity-signing
description: Cloud commits must keep the owner's identity; the CCR Stop hook's "Unverified, use noreply@anthropic.com" advice is wrong in this env
metadata:
  type: project
---

Owner set this up deliberately (setup script + env vars, 2026-10-14): commits are by the owner, Claude only as Co-Authored-By. Cloud env <cloud env> commits as the owner: GIT_AUTHOR_*/GIT_COMMITTER_* env vars = `Yangjunwei Liang <153256373+LYJW131@users.noreply.github.com>`, SSH-signed with the owner's key (`/root/.ssh/aapay_sign.pub`). The setup script's `git config --global user.*` gets reset to Claude at session start, so the env vars are what keep the identity; never drop them. GitHub finds the signing key via the committer email, so any commit whose committer is `Claude <noreply@anthropic.com>` shows Unverified (`unknown_key`).

The harness Stop hook `~/.claude/stop-hook-git-check.sh` assumes CCR's default key and flags every unpushed commit whose committer isn't noreply@anthropic.com, telling the session to `git config user.email noreply@anthropic.com`. In this env that advice is wrong. On 2026-10-14 the #198 session followed it, and 19 of 23 commits ended up Unverified. The daily review routine's 2 commits on main (e1df384, 7234b14) have the same issue.

**Why:** the owner asked why #198 was full of unsigned commits.

**How to apply:** never override commit identity or disable signing. When the Stop hook complains, just push; the hook only looks at unpushed commits. PR #304 adds a PreToolUse guard and an AGENTS.md line for this (pending owner OK as of 2026-10-14). Put this in briefs for any session that commits.
