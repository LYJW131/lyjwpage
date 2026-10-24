---
name: claude-actions-billing-wif
description: Claude GitHub Actions stay on the subscription setup token; WIF/API billing tried and removed because Max plan API credit excludes the Claude Code GitHub Action (2026-10-24 SGT, #625/#628/#637)
metadata:
  type: project
---

History (2026-10-24 SGT): lyjw wanted Claude Actions off subscription quota. #625 added WIF (GitHub OIDC → Anthropic token, no static key; lyjw rejected API keys) with switch var `CLAUDE_AUTH=oauth`. Every Action then failed with 400 "Credit balance is too low". #628 added a launcher that unset `CLAUDE_CODE_ENTRYPOINT`/`CLAUDE_CODE_ACTION` (workaround from anthropics/claude-code-action#1901) and it billed fine.

lyjw then realized (05:21 SGT) the Console balance is the Max plan's monthly API credit (shown as "Promotional credits"). Docs confirm it does not cover Claude Code: platform.claude.com/docs/en/about-claude/api-credits-for-subscribers ("Doesn't cover: Claude Code"); support article 17154008: runs started by the Claude Code GitHub Action count as Claude Code usage even with `-p`. The 400 is policy, keyed on the action's entrypoint markers; stripping them misuses the credit (~$0.15 spent).

lyjw 05:53 SGT: switch back to subscription and remove the API integration; lyjw revoked the Console side 05:54 SGT (federation rule fdrl_012epwhUyPaCQHHAtzx535yA, service account svac_01URxacmVs5jj36HUpnnAZN2). #637 removes the launcher, federation inputs, verify jobs' `id-token: write` and `anthropic-wif-test.yml`. The 4 repo vars ANTHROPIC_FEDERATION_RULE_ID / _ORGANIZATION_ID / _SERVICE_ACCOUNT_ID / _WORKSPACE_ID were deleted by lyjw 05:58 SGT (gh on the Mac; cloud proxy 403s on the Actions variables API).

**How to apply:** don't re-propose marker stripping or using Max plan API credit for Claude Actions. API billing for Actions is only legitimate with purchased Console credit (then no wrapper needed). Static API key secret was also rejected by lyjw. lyjw posted the explanation on #1901 themselves (2026-10-24 06:26 SGT).

Related: [[verify-in-actions-plan]].
