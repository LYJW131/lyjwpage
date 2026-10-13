---
name: pr-bot-reviews-before-merge
description: Before merging or calling a PR ready, also clear every bot review in the PR discussion (Devin, Codex, Claude, Cursor), not just CI
metadata:
  type: feedback
---

Before merging any PR, or telling the user it is ready, CI green is not enough. Read every machine review in the PR discussion: Devin review threads, Codex, the Claude Code Review, Cursor Bugbot (CodeQL no longer runs on ordinary PRs: [[codeql-policy]]). Fix each finding or reply on its thread explaining why not. Re-check after the last push, because some bots only post on ready_for_review.

**Why:** PR #200 merged with two unhandled Devin threads. Devin posted them about 2 min after the PR was marked ready; the agent had only watched CI. The user flagged this on 2026-10-13.

**How to apply:** after each push, and again right before merge, list the PR's reviews, review threads and issue comments, and clear every bot item.
