---
name: visitor-build-relaxed
description: lyjw 2026-10-27 decided visitor-build path guards were over-defensive; #710 keeps only paths executed or auto-loaded before merge
metadata:
  type: project
---

lyjw 2026-10-27 07:19 (SGT) on the visitor build (`workers/ai/src/build/`): 「太过度防御了，之后又不是不审查了」. Picked「1–5 全做」, shipped in #710 (merge 002ae06, live 07:55 SGT).

Rule now: a path is denied only if it runs or is auto-loaded as agent instructions **before merge** (PR workflows, Workers Builds preview, a Claude session checking out the branch). Still denied: `.github/`, `.claude/`, AGENTS/CLAUDE/`REVIEW.md` (REVIEW.md is `@`-imported by AGENTS.md), `scripts/`, manifests/locks, wrangler/vite/next config, `reporters/`, submodules, symlinks.

- Disallowed upload paths are dropped and listed in the PR, not a whole-upload reject.
- Rule docs and `PROJECT_DOCS` are allowed, flagged「rules or model-context document」.
- No cap on files outside the plan; plan prose may name protected files.
- Failed plan-only drafts get a PR comment with the reason (close first, then comment).

**Why:** #707 died because the implementer updated `workers/ai/README.md` (a PROJECT_DOCS file); the bot closed the draft with no comment.
**How to apply:** don't propose new visitor-build guards that duplicate lyjw's review; a new guard must name what it runs or loads before merge. #707's patch was rescued as #711.
