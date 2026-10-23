---
name: jev-comment-check
description: Jev as advisory comment-rule checker on PRs (lyjw 2026-10-23 19:32 SGT asked; PR #610): labelled set, chunk size 10 matters, results go to pr-gate notes
metadata:
  type: project
---

lyjw 2026-10-23 19:32 SGT「补一处注释规则检查的action jev输出结果给主线程作为建议」, then asked to test on labelled real comments first. Built in PR #610: `scripts/comment-check.ts`, `.github/workflows/comment-check.yml`, check run `Comment check (Jev)` (neutral = has suggestions, never blocks), surfaced in `scripts/pr-gate.ts` notes via `pr-gate/checks.ts#commentAdvice`. PR comment (lyjw 2026-10-23 19:55 SGT「实际检查过注释的时候才发 成功也发 要删改也发 就原地更新」): lyjw131[bot] (lyjw 2026-10-23 20:30 SGT「同意接私钥」; a separate `comment` job checks out main and runs only main's `comment-check.ts --post` on the jev job's JSON, like #613) posts one comment marked `<!-- comment-check-jev -->` only once Jev asked about ≥1 comment, then PATCHes it on every push. Workflow has a JS/TS `paths` filter, so a push that drops all JS/TS leaves the old comment (it shows its sha; pr-gate reads the check run, not the comment).

Labelled set `scripts/comment-check-cases.json`: 70 random repo comments (2 labelled delete) + 36 planted bad ones in real code context. Calibrate with `NODE_USE_ENV_PROXY=1 node scripts/comment-check-calibrate.ts`.
- 40 comments per call: precision 0.70–0.84, recall ~0.5 (neighbours bleed). 10 per call: precision 1.00, recall 0.87–0.92 at 0.7. Keep it at 10.
- Misses: copied-value comments ("4 秒超时", "确认缓存 5 分钟"). Recent main: 46 new comments, 0 flagged.
- Background: before this, only TODO tickets and JSDoc were enforced (`pnpm rules:check`); the three-kinds rule relied on self-check and bot review.

Fits the Jev pattern from the thread「Jev 能用在哪里」: fixed question, high volume, wrong answer cheap, labelled data for thresholds. Related: [[jev-verify-trial]], [[jev-vision-qa-result]].
