---
name: claude-actions-billing-wif
description: Claude GitHub Actions billing switch — lyjw wants WIF (GitHub OIDC), not a static API key; switch-back via CLAUDE_AUTH=oauth (2026-10-24 SGT, PR #625)
metadata:
  type: project
---

lyjw 2026-10-24 02:31 SGT: subscription quota running out, move every Claude Action off the setup token to API billing, must be able to switch back any time. 02:36 SGT「我不想用 API key」→ use Workload Identity Federation (GitHub OIDC → short-lived Anthropic token; still API pay-as-you-go on the Console workspace). lyjw sets the Console side and monthly cap themselves.

#625 merged 2026-10-24 02:50 SGT (70c93b7); the 4 repo vars were set 02:48 SGT, so Claude Actions now bill via WIF. First test 2026-10-24 02:54 SGT (Console sample workflow `.github/workflows/anthropic-wif-test.yml`, on: push, on branch claude/project-thread-1dyolh, run 40007103089) FAILED: 401 Authentication failed; deny reason only on Console Authentication history page. Reason was match_subject_prefix: GitHub now sends ID-qualified sub `repo:LYJW131@153256373/lyjwpage@1331086735:<context>` while the Console wizard wrote the old `repo:LYJW131/lyjwpage:` form. lyjw set the rule's subject prefix to `repo:LYJW131@153256373/lyjwpage@1331086735:*`; rerun at 02:55 SGT got an access_token (598 s, workspace:developer). Test workflow stays only on the branch (not merged; on: push would run on every push). lyjw wants the Console sample used verbatim for tests, not a full Verify run.

State in #625: `claude.yml`, `claude-code-review.yml` and `verify.yml` (verify, verify-ab, judge) use WIF when repo vars `ANTHROPIC_FEDERATION_RULE_ID`, `ANTHROPIC_ORGANIZATION_ID`, `ANTHROPIC_SERVICE_ACCOUNT_ID` are set; `CLAUDE_AUTH=oauth` or no vars → setup token. lyjw agreed 2026-10-24 02:41 SGT to give the verify jobs (which run PR code) `id-token: write`. `build.yml` stays on setup token on purpose (implement job must not get id-token; the ai Worker trusts build.yml OIDC tokens).

Don't re-propose a static `ANTHROPIC_API_KEY` secret for Actions. claude-code-action docs: don't set `anthropic_api_key`/`claude_code_oauth_token` alongside federation inputs.

Console federation rule: GitHub owner LYJW131 is a user account, numeric owner ID 153256373 (pins trust); scope only the capped workspace; audience/CEL blank, default scope and 10-min lifetime.

IDs (not secrets, 2026-10-24 SGT): rule fdrl_012epwhUyPaCQHHAtzx535yA, org 5ac99a46-8fcf-4cb2-99b8-83382c7ce79b, service account svac_01URxacmVs5jj36HUpnnAZN2 (lyjwpage-actions), workspace wrkspc_01EKGUJQbX9gKyF1ohp8WmUo. Fourth repo var ANTHROPIC_WORKSPACE_ID added (rule targets all workspaces). Cloud GitHub proxy 403s on Actions variables API; lyjw sets vars in the UI or via Mac RC.

Root cause found 2026-10-24 04:00 SGT: same WIF token/workspace, plain Claude Code CLI works, but adding `CLAUDE_CODE_ENTRYPOINT=claude-code-github-action` (which claude-code-action forces in `base-action/src/parse-sdk-options.ts`) returns 400 `Credit balance is too low` (run 40015550391). So all Claude Actions fail under WIF. Profile/config-dir path is NOT the cause. Upstream known bug anthropics/claude-code-action#1901/#1888. lyjw chose (decision card, 2026-10-24 SGT) a wrapper: `.github/actions/claude-unmarked` installs Claude Code and unsets CLAUDE_CODE_ENTRYPOINT/CLAUDE_CODE_ACTION before exec, passed via `path_to_claude_code_executable` (PR #628). Branch test run 40016344448: OK, $0.08 billed to API. Remove the wrapper once #1901 is fixed. Actions need `github_token` input when the workflow differs from main.

Token lifetime: 10 min rule default is fine. claude-code-action rewrites the OIDC JWT file every 4 min (`base-action/src/workload-identity.ts#REFRESH_INTERVAL_MS`) and the CLI re-exchanges 120 s before expiry; minted lifetime is capped at 2x the GitHub JWT's remaining life (JWT is 300 s), so longer rule lifetimes don't help. Long-run refresh not yet observed in practice.

Related: [[verify-run-timing]], [[verify-in-actions-plan]].
