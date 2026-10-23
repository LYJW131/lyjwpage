---
name: verify-action-token-usage
description: Measured Claude token scale per Verify Action run (Haiku verifier vs Opus judge), 2026-10-23, and where the usage numbers live in the logs
metadata:
  type: reference
---

Measured 2026-10-23 16:16–21:03 SGT over 34 verifier jobs and 17 judge jobs of `.github/workflows/verify.yml` (lyjw asked「每次验证大概多少」). Medians:

- Verifier (Haiku, effort high): 20 turns, ~2.3 min in Claude (job wall ~3.5 min), input ~26, output ~22k (about 60% thinking), cache read ~740k, cache write ~68k. List-price cost ~$0.03.
- Judge (Opus, only with `needs-judge`): 15 turns, ~1.8 min, output ~8k (about 40% thinking), cache read ~810k, cache write ~75k. List-price cost ~$1.0 (max $1.4).
- Receipt (structured_output) ≈ 0.65 tokens per char: verifier ~4k chars ≈ 2.6k tokens (~12% of output), judge ~2.4k chars ≈ 1.6k tokens (~20%). Shortening receipts saves a little output; the bulk is thinking and per-turn cache reads.
- Jobs that failed in setup (apt exit 100 etc.) never reached Claude: no tokens.

How to re-measure: the job log of the `claude` step prints the final `"type": "result"` JSON (because `show_full_output: true`) with `usage`, `modelUsage` (incl. `thinkingTokens`), `num_turns`, `duration_ms`, `total_cost_usd`; fetch via `gh api repos/LYJW131/lyjwpage/actions/jobs/<id>/logs`. Related: [[verify-in-actions-plan]], [[token-efficiency-review]].
