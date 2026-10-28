---
name: jev-comment-check
description: Jev as advisory comment-rule checker on PRs (lyjw 2026-10-23 19:32 SGT asked; PR #610): labelled set, chunk size 10 matters, results go to pr-gate notes
metadata:
  type: project
---

lyjw 2026-10-23 19:32 SGT「补一处注释规则检查的action jev输出结果给主线程作为建议」, then asked to test on labelled real comments first. Built in PR #610: `scripts/comment-check.ts`, `.github/workflows/comment-check.yml`, check run `Comment check (Jev)` (neutral = has suggestions, never blocks), surfaced in `scripts/pr-gate.ts` notes via `pr-gate/checks.ts#commentAdvice`. PR comment (lyjw 2026-10-23 19:55 SGT「实际检查过注释的时候才发 成功也发 要删改也发 就原地更新」): lyjw131[bot] (lyjw 2026-10-23 20:30 SGT「同意接私钥」; a separate `comment` job checks out main and runs only main's `comment-check.ts --post` on the jev job's JSON, like #613) posts one comment marked `<!-- comment-check-jev -->` only once Jev asked about ≥1 comment, then PATCHes it on every push. Workflow has a JS/TS `paths` filter, so a push that drops all JS/TS leaves the old comment (it shows its sha; pr-gate reads the check run, not the comment).

Labelled set `scripts/comment-check-cases.json`: 70 random repo comments (2 labelled delete) + 36 planted bad ones in real code context + 62 field comments from PRs (`source: field #PR`, 18 delete; added 2026-10-26). Calibrate with `NODE_USE_ENV_PROXY=1 node scripts/comment-check-calibrate.ts`.
- 40 comments per call: precision 0.70–0.84, recall ~0.5 (neighbours bleed). 10 per call: precision 1.00, recall 0.87–0.92 at 0.7 (original 106 cases). Keep it at 10. Current threshold `YES` is 0.6, see field result below.
- Misses: copied-value comments ("4 秒超时", "确认缓存 5 分钟"). Recent main: 46 new comments, 0 flagged.
- Background: before this, only TODO tickets and JSDoc were enforced (`pnpm rules:check`); the three-kinds rule relied on self-check and bot review.

Fits the Jev pattern from the thread「Jev 能用在哪里」: fixed question, high volume, wrong answer cheap, labelled data for thresholds. Related: [[jev-verify-trial]], [[jev-vision-qa-result]].

Gotcha (fixed #620, 2026-10-23): the `comment` step is continue-on-error, so a failed post shows green; the App token needs `permission-pull-requests: write` (issues alone gave 403 on #619). If no Jev comment appears, read the comment job log first.

Field result (eval 2026-10-26, report <private claude.ai link>): 180 runs / 50 PRs / 209 comments in 3 days. Listed 6 (≥0.7), all real and all deleted (precision 6/6); 0 Jev failures, Jev call ~1 s, job ~26 s. Recall only ~1/3: misses sit in the hidden 0.3–0.7 band (0.5–0.7: 5 of 13 kept were "delete"), mostly canvas-drawing comments that describe the picture (#672, #690); ≤0.3 band held up (0 of 111). #670 0.29 caught only by Devin. lyjw 2026-10-26 22:50 SGT「好 优化效果吧」: YES lowered to 0.6 (neutral), [0.5, 0.6) listed as 拿不准 (not neutral), 62 field cases (source `field #PR`) added to the labelled set; 168 cases: 0.6 precision 0.98 recall ~0.85 vs 0.7 1.00/~0.75. A rule tweak naming 'describes what the code draws' raised recall but dropped precision to ~0.9, not adopted. No-run cases: PR with merge conflict, PR opened before the workflow reached main.

Whole-file trial (2026-10-28 07:40 SGT, from allietheicon "line-by-line search" tweet): whole file numbered in `state.document`, one noul per comment, vs current 10-per-call snippets, 2 runs each. Whole file was available for only 107/168 cases (5 delete). At 0.6: all-cases recall unchanged (0.88 vs 0.84–0.86), precision 0.94–0.96 vs 0.98 (more false positives). No gain; not adopted. Retry only with a labelled set that stores whole files at the comment's commit.
