---
name: codeql-policy
description: CodeQL in lyjwpage only scans visitor-build PRs (claude/build-*) as their draft→ready gate; other PRs aren't scanned; main has no required checks so lyjw can push directly
metadata:
  type: project
---

Set by lyjw on 2026-10-13 and merged in PR #222 (bfde655). The path there:
- "codeql 每轮提交都跑影响迭代速度"
- then "开分支保护"
- then "还是允许我直推吧"
- final: "只对站点build来的pr在合入main前跑"

Current state:
- **On PRs:** `.github/workflows/codeql.yml` runs only on `claude/build-*` branches, the visitor Build flow. Other PRs get a skipped placeholder check.
- **Other runs:** pushes to main/dev scan the changed languages, and a scheduled scan runs twice a day.
- **Visitor-build gate:** the ai Worker's `markBuildReady` keeps the build PR as a draft until every check in `workers/ai/src/build/checks.ts#BUILD_READY_CHECKS` has passed: `check` plus both `Analyze` jobs. The gate lives there, not in branch protection.
- **main protection:** only "require conversation resolution", with no required status checks, so lyjw can push directly. Branch-protection writes go through Remote Control on the Mac, and the Mac's auto mode blocks them until lyjw OKs it in the thread.
- **Merge gate:** don't wait for CodeQL on ordinary PRs. The bot-review gate ([[merge-requires-bot-review-pass]]) still covers Devin, Codex, Claude review and Bugbot.

Related: [[lyjwpage-daily-review-routine]], whose prompt still lists CodeQL among the checks to wait for. That entry is stale but harmless.
