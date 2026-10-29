---
name: codeql-policy
description: CodeQL in lyjwpage only scans visitor-build PRs (claude/build-*) as their draft→ready gate; other PRs aren't scanned; main has no required checks; PR required since 2026-10-20
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
- **main protection:** lyjw 2026-10-20 19:54 SGT reversed "允许我直推": main now requires a PR (0 approvals, no force push) plus conversation resolution; still no required status checks. Personal-repo protection has no bypass list, so `avatar-sync.yml` opens a PR and squash-merges it instead of committing to main.
- **Merge gate:** don't wait for CodeQL on ordinary PRs. The bot-review gate ([[merge-requires-bot-review-pass]]) still covers Devin, Codex, Claude review and Bugbot.

Related: [[lyjwpage-daily-review-routine]].

**Alert handling (lyjw 2026-10-29「撤掉 cursor 自动盯 codeql 并修复的 action，交给项目自身巡检任务每次看一眼 codeql」):** the Cursor-based CodeQL Autofix workflow (`codeql-autofix.yml` + scripts) was removed. Open CodeQL alerts are now looked at once per run by the daily code review routine; its prompt is changed only from its own session.

Cloud sessions get 403 on the code-scanning alerts API (rechecked 2026-10-29). lyjw 2026-10-29 settled (after a draft PR, then a bot-opened issue):「就应该是这样」— one standing issue「CodeQL 告警」#763 opened by lyjw's account with label `Automation` and body starting `<!-- codeql-alerts -->`, never closed. `.github/workflows/codeql-alerts.yml` runs after each successful CodeQL run on main and, as lyjw131[bot], comments only when the open set changes (new alerts table, closed numbers, hidden `<!-- codeql-alerts-open [..] -->` with the current set); it never opens or edits issues and fails red if the issue is missing. Like #185/#280, fixes are linked by the fix PR body writing `Refs #763` (lyjw「线程修的时候引用那个 issue」), not by separate disposition comments. Mac Remote Control with lyjw's gh login also works for one-off reads. Devin Review on CodeQL fix PRs tends to find more regex-vs-HTML edge cases (alert #35, fixed in #528, 2026-10-21).
