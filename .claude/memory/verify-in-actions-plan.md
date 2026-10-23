---
name: verify-in-actions-plan
description: Verify Action (Haiku verifier + parallel Opus judge in GitHub Actions, bot-signed receipts) built in PR #572; facts learned while testing it
metadata:
  type: project
---

lyjw 2026-10-23 16:03 SGT asked to move the verifier fully into GitHub Actions, test it, and debug the hollow claude-review. Built in PR #572 (`.github/workflows/verify.yml`, `scripts/verify-action.ts`). How it works lives in skill `lyjwpage-verify`「PR 上的验证：Verify Action」; don't duplicate it here.

Decisions lyjw made (don't re-ask):
- **Ask lyjw before the final merge of #572** (lyjw 2026-10-23 16:32 SGT「这个pr最终合并前先问我」).
- PR body carries「## 验证清单」(V1…) and「## lyjw 原话」; the Action verifies against them.
- Money is fine (setup-token, subscription quota). Visitor-PR security is not a concern (PRs locked; visitors only via the design flow).
- A PR that edits the verifier can forge its own receipt; lyjw 2026-10-23 17:12 SGT「不堵了 只标记出来改过验证员」: no blocking, `pr-tier-label.yml` puts a red `verifier-changed` label on it (paths: `scripts/pr-gate/tier.ts#verifierFiles`). Don't re-propose pull_request_target.
- PR tier labels `tier: docs/ui/logic/ui+logic` by `lyjw131[bot]` are display only (lyjw「我只是想看而已」, #586); gates never read them.
- Opus judge runs **in parallel** with the Haiku verifier on logic-tier PRs (「并行跑」).
- Merge hook enforces receipts (lyjw 2026-10-23 19:15 SGT「之前那个线程说的合并检查钩子我觉得可以加上」): `scripts/guard-merge-method.ts#receiptReason` blocks unless an Action-signed receipt covers head at the tier level (ui → live-ui-verified, logic → unit-test-verified); pr-gate `--need` doesn't loosen it; unverifiable PRs go to lyjw for a hand merge. Shipped inside #572.
- **Facts gate, judgment stays with the thread** (lyjw 2026-10-23 19:23 SGT「我感觉我们做的太硬了 其实很多都可以交给agent自己判断的」; card 19:28 SGT「等级照分档卡，Opus 按需」): the Opus judge (and Claude review) run only when the PR has the `needs-judge` label, which the thread adds for big changes; the hook then wants judge PASS, and a FAIL judge on head blocks even when not asked. Receipt levels stay tier-fixed. Don't re-propose letting threads pick the receipt level; auto mode also blocked that as CI Bypass.
- Subprocess env scrub needs bubblewrap + socat and a bwrap-only AppArmor profile (lyjw picked this on a decision card, 2026-10-23 19:10 SGT; same as build.yml).

Facts learned from real runs (2026-10-23):
- First end-to-end run (39923479225) took ~4.5 min; both models found real bugs (empty-evidence receipts, title-edit cancelling verification).
- claude-code-action restores `.claude/`, `CLAUDE.md` etc. from main on PRs ("PR head is untrusted"); PR copies land in `.claude-pr/`. So the verifier follows main's skill; skill edits take effect after merge. It does NOT restore `AGENTS.md`, `REVIEW.md` or nested `AGENTS.md`; root `CLAUDE.md` is just `@AGENTS.md`, so a PR's AGENTS.md edits steer its own verifier/judge at once.
- Workflow-level `concurrency` applies before job `if`, so a no-op `edited` event must go to a different group.
- `actions/setup-node` auto package-manager cache fails without pnpm installed: set `package-manager-cache: false` on jobs that skip pnpm.
- The runner's azure apt mirror stalls often (one run hung 40+ min; #593's test run again). `timeout` outside `sudo` leaves apt-get alive holding the dpkg lock, so retries fail. verify.yml now installs browsers without deps, installs apt deps only on UI-tier PRs, with `sudo timeout` and a retry that drops the azure mirror.
- Verifier/judge diff against the PR's base branch, not origin/main (stacked test PRs mixed in base commits).
- **Scripts read structured data, not Chinese prose** (lyjw 2026-10-23 19:30 SGT「感觉我们的机器识别脚本一直在读模型输出的中文来判断 好蠢啊」, also for the test-PR title marker): receipts/judges carry `<!-- verify-stamp {"sha","level"|"verdict","body"} -->` on line 2 and scripts read only that (the Chinese line 1 is for humans); judge request is the `needs-judge` label. Editing the checklist or lyjw's words changes `body` and voids old receipts. Next step if wanted: receipts as check runs.

Independent review (verdict 需先修) and the security rules it produced: [[verify-action-review-572]]. Code-review diagnosis: [[claude-review-hollow]]. Related: [[verification-haiku-worker]], [[merge-requires-bot-review-pass]].
