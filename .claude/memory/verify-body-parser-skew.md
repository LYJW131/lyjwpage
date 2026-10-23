---
name: verify-body-parser-skew
description: PRs that change scripts/verify-action/body.ts get no receipt if the PR body parses differently under main and branch code
metadata:
  type: project
---

Seen on #618 (2026-10-23): the verify job runs the branch's `body.ts` and records the body digest; publish runs main's `body.ts` and recomputes it. When the two parsers disagree on the PR description, publish logs「验证员读的是改之前的 PR 描述或目标分支，这次不发」 and posts no receipt, though the job is green.

**How to apply:** on a PR that changes comment stripping or checklist parsing in `body.ts`, keep the description free of the constructs that changed (on #618: a literal HTML comment opener in backticks). If a Verify run is green but no receipt appears, read the publish job log first.

Related: [[verify-in-actions-plan]].

Outcome on #618: after four rounds of Devin/Verify counterexamples to regex-based Markdown comment/code detection, `body.ts` stopped stripping HTML comments at all (only the Devin badge, looped until stable). Don't reintroduce comment stripping there; regex can't parse Markdown and errors swallow visible checklist items.
