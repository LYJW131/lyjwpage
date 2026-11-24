---
name: t3-transition-check-skip
description: During T3 Code local transition, skip environment-unready checks or agent reviews without stalling and report the gap; local Devin CLI logged in and usable (2026-11-25)
metadata:
  type: feedback
---

**Rule (lyjw 2026-11-25 07:26 UTC+8):**
- 「现在有些检查可以适当跳过一下」
- 「我意思是现在刚切来t3 有些检查可能环境没配置跑不了 比如一些agent审查什么的 跑不了就不跑了 然后devin我刚刚登录了 要用的话现在可以用了」

**How to apply:**
- Working local gates (`pnpm docs:check`, `pnpm rules:check`, `pnpm baselines:check`, `pnpm typecheck`, `pnpm exec eslint`, relevant `pnpm test` / `pnpm build`) still run as normal.
- Any check or agent review that cannot run because the T3 local environment is not yet configured or because it depends on retired cloud-container / old OAuth tooling: **skip directly without waiting or blocking the workflow**, and explicitly list what was skipped and why in the report's 「没验到」 section. Never claim a skipped check passed.
- Local **Devin CLI** (`devin`, logged in by lyjw on 2026-11-25 UTC+8) is now available for `lyjwpage-pr-review` (`agents/pr-review/run.ts`); if it still cannot run or hits limits, fall back to skipping and note 「评审员没跑成」 as before.
- Core human-approval boundaries are unchanged (UI/UX screenshots + lyjw OK, irreversible production actions, `baseline-exception` label).

Related: [[merge-ci-wait-tiers]], [[pr-review-auto]], [[verify-action-state]], [[repo-memory-mirror]].
