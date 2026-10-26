---
name: verify-fail-causes
description: Why Verify Action receipts came back failed/blocked (27 receipts, #572–#638, classified 2026-10-24 SGT) and which env gaps were fixed
metadata:
  type: project
---

lyjw 2026-10-24 06:15 SGT asked whether the many 不过 receipts since moving the verifier into Actions were real or env gaps. Sampled all 27 verifier-failed/blocked receipts on #572–#638 (Sonnet worker, table at /tmp only, not kept).

Result: about 17 real defects (mostly doc/comment drift and receipt edge cases; later pushes fixed them), 6 verifier misjudgments, 2–3 env gaps.

Env gaps (evidence from job logs):
- **Bash sandbox can't write `$RUNNER_TEMP/verify-out`** (`Read-only file system` in #628, #632, #635, #636, #637): `CLAUDE_CODE_SUBPROCESS_ENV_SCRUB` sandbox writes only cwd, $TMPDIR, `--add-dir`. Fix: `--add-dir` in verify.yml, PR #645. Unknown why #622 (17:58 UTC same CLI 2.1.309) still wrote fine.
- **Job output dropped as "may contain secret"** (#636 run 40028957802: `Skip output 'result' since it may contain secret`) → publish saw empty VERIFY_OUTPUT → "验证员没交回结构化结果". In #636 the masked text was a credential-like line the verifier wrote. #688 (memory-mirror secret-check PR, 2026-10-26) hit it on all three heads (runs 40329139205, 40331310023, 40332447891): its diff is full of credential-like test strings, so a re-run won't help; merge by tier and name the gap in a PR comment. No artifact fallback: it would bypass GitHub's masking.
- `.mcp.json` is a /dev/null char device in the runner, `pnpm rules:check` EACCES (#572, #610).

Verifier misjudgment patterns, fixed by three prompt lines in #645 (lyjw 2026-10-24 06:26 SGT「改好来吧」, overriding the earlier decline in [[merge-requires-bot-review-pass]]): unverifiable-by-design items (post-merge, workflow YAML unit test, real Action run) marked SKIPPED → blocked; low-priority/pre-existing nits marked FAIL → failed (no severity field in `reconcile`); test PRs failed for intentional demo text.

Related: [[verify-in-actions-plan]], [[verify-run-timing]].
