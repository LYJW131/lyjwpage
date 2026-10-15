---
name: merge-commit-format
description: lyjwpage PR merges must use `pnpm merge-message <PR> "<title>"` output as commit_title/commit_message, not GitHub's default "Merge pull request #N from …"
metadata:
  type: feedback
---

lyjw (2026-10-13): the homepage Commits card showed "Merge pull request #202 from …" and couldn't tell what changed or which agents/models worked on it — "规定merge格式并补coauthor行". Rule now lives in root AGENTS.md「部署流程」 (merged in PR #207, d92dc70).

**How to apply:** before merging any lyjwpage PR (coordinator, routine, or thread), check out the PR head, `git fetch origin main`, run `pnpm merge-message <N> "<PR title>"`, pass its `commit_title` / `commit_message` / `expectedHeadSha` verbatim to `merge_pull_request` with `merge_method: merge`. `expectedHeadSha` (added 2026-10-16 SGT from magpie, lyjw picked it) is the local HEAD you verified; if the PR got commits you didn't verify the merge fails: fetch, re-verify, retry; never drop the parameter. PR titles follow `type(scope): 描述`. Same day, lyjw approved setting repo default merge_commit_title=PR_TITLE / merge_commit_message=PR_BODY for hand merges on GitHub, applied via Remote Control + gh on the Mac. Mac auto mode blocks repo-setting writes until lyjw says so explicitly in the thread.

Related: [[merge-requires-bot-review-pass]], [[lyjwpage-daily-review-routine]].
